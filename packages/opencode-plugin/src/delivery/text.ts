import type { BindingDeliveryTarget } from "../binding"
import type { GatewayTransportHost } from "../host/transport"
import type { SqliteStore } from "../store/sqlite"
import { recordTelegramPreviewEmit, recordTelegramStreamFallback } from "../telegram/state"
import { createDraftId, type DeliveryModePreference, type TelegramProgressiveSupport } from "./telegram"

export type TextDeliverySession = {
    mode: "oneshot" | "progressive"
    preview(text: string): Promise<void>
    finish(finalText: string | null): Promise<boolean>
}

export class GatewayTextDelivery {
    constructor(
        private readonly transport: GatewayTransportHost,
        private readonly store: SqliteStore,
        private readonly telegramSupport: TelegramProgressiveSupport,
    ) {}

    async open(target: BindingDeliveryTarget, preference: DeliveryModePreference): Promise<TextDeliverySession> {
        const mode = await this.telegramSupport.resolveMode(target, preference)
        if (mode === "progressive") {
            return this.openProgressiveSession(target)
        }

        return new OneshotTextDeliverySession(target, this.transport)
    }

    async sendTest(
        target: BindingDeliveryTarget,
        text: string,
        preference: DeliveryModePreference,
    ): Promise<{
        delivered: boolean
        mode: "oneshot" | "progressive"
    }> {
        const session = await this.open(target, preference)
        if (session.mode === "progressive") {
            await session.preview(text.slice(0, Math.max(1, Math.ceil(text.length / 2))))
        }

        return {
            delivered: await session.finish(text),
            mode: session.mode,
        }
    }

    private openProgressiveSession(target: BindingDeliveryTarget): TextDeliverySession {
        const session = new ProgressiveTextDeliverySession(target, this.transport, this.telegramSupport, this.store)
        session.start()
        return session
    }
}

class OneshotTextDeliverySession implements TextDeliverySession {
    readonly mode = "oneshot" as const

    constructor(
        private readonly target: BindingDeliveryTarget,
        private readonly transport: GatewayTransportHost,
    ) {}

    async preview(_text: string): Promise<void> {}

    async finish(finalText: string | null): Promise<boolean> {
        if (finalText === null || finalText.trim().length === 0) {
            return false
        }

        const ack = await this.transport.sendMessage({
            deliveryTarget: this.target,
            body: finalText,
        })

        if (ack.errorMessage !== null) {
            throw new Error(ack.errorMessage)
        }

        return true
    }
}

class ProgressiveTextDeliverySession implements TextDeliverySession {
    readonly mode = "progressive" as const
    private previewFailed = false
    private previewDelivered = false
    private closed = false
    private pendingPreviewCount = 0
    private pendingPreview = Promise.resolve()
    private readonly draftId = createDraftId()

    constructor(
        private readonly target: BindingDeliveryTarget,
        private readonly transport: GatewayTransportHost,
        private readonly telegramSupport: TelegramProgressiveSupport,
        private readonly store: SqliteStore,
    ) {}

    start(): void {
        this.telegramSupport.startTyping(this.target)
    }

    async preview(text: string): Promise<void> {
        if (this.previewFailed || this.closed) {
            return
        }

        const runPreview = async (): Promise<void> => {
            try {
                if (this.previewFailed || this.closed) {
                    return
                }

                try {
                    recordTelegramPreviewEmit(this.store, Date.now())
                    await this.telegramSupport.sendDraft(this.target, this.draftId, text)
                    this.previewDelivered = true
                } catch {
                    this.previewFailed = true
                }
            } finally {
                this.pendingPreviewCount = Math.max(0, this.pendingPreviewCount - 1)
            }
        }

        this.pendingPreviewCount += 1
        this.pendingPreview = this.pendingPreview.then(runPreview, runPreview)
        await this.pendingPreview
    }

    async finish(finalText: string | null): Promise<boolean> {
        this.closed = true
        if (this.pendingPreviewCount > 0) {
            await this.pendingPreview
        }

        if (finalText === null || finalText.trim().length === 0) {
            return false
        }

        if (!this.previewDelivered) {
            if (!this.previewFailed) {
                recordTelegramStreamFallback(this.store, "preview_not_established", Date.now())
            }
        }

        return await this.sendFinal(finalText)
    }

    private async sendFinal(body: string): Promise<boolean> {
        const ack = await this.transport.sendMessage({
            deliveryTarget: this.target,
            body,
        })

        if (ack.errorMessage !== null) {
            throw new Error(ack.errorMessage)
        }

        return true
    }
}
