import type { BindingDeliveryTarget, GatewayBindingModule, ProgressiveTextHandle } from "../binding"
import type { GatewayTransportHost } from "../host/transport"
import type { SqliteStore } from "../store/sqlite"
import { recordTelegramStreamFallback } from "../telegram/state"
import { createDraftId, type DeliveryModePreference, type TelegramProgressiveSupport } from "./telegram"

const DEFAULT_FLUSH_INTERVAL_MS = 400

export type TextDeliverySession = {
    mode: "oneshot" | "progressive"
    preview(text: string): Promise<void>
    finish(finalText: string): Promise<boolean>
}

export class GatewayTextDelivery {
    constructor(
        private readonly module: GatewayBindingModule,
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
        const state = this.createProgressiveHandle()
        if (state === null) {
            recordTelegramStreamFallback(this.store, "progressive_handle_unavailable", Date.now())
            return new OneshotTextDeliverySession(target, this.transport)
        }

        return new ProgressiveTextDeliverySession(target, this.transport, this.telegramSupport, state)
    }

    private createProgressiveHandle(): ProgressiveTextHandle | null {
        try {
            return this.module.ProgressiveTextHandle.progressive(DEFAULT_FLUSH_INTERVAL_MS)
        } catch {
            return null
        }
    }
}

class OneshotTextDeliverySession implements TextDeliverySession {
    readonly mode = "oneshot" as const

    constructor(
        private readonly target: BindingDeliveryTarget,
        private readonly transport: GatewayTransportHost,
    ) {}

    async preview(_text: string): Promise<void> {}

    async finish(finalText: string): Promise<boolean> {
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
        private readonly state: ProgressiveTextHandle,
    ) {}

    async preview(text: string): Promise<void> {
        if (this.previewFailed || this.closed) {
            return
        }

        const runPreview = async (): Promise<void> => {
            try {
                if (this.previewFailed || this.closed) {
                    return
                }

                const directive = this.state.observeSnapshot(text, monotonicNowMs())
                if (directive.kind !== "preview" || directive.text === null) {
                    return
                }

                try {
                    await this.telegramSupport.sendDraft(this.target, this.draftId, directive.text)
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

    async finish(finalText: string): Promise<boolean> {
        this.closed = true
        if (this.pendingPreviewCount > 0) {
            await this.pendingPreview
        }

        const body = this.resolveFinalBody(finalText)
        if (body === null) {
            return false
        }

        return await this.sendFinal(body)
    }

    private resolveFinalBody(finalText: string): string | null {
        if (!this.previewDelivered) {
            return finalText.trim().length === 0 ? null : finalText
        }

        const directive = this.state.finish(finalText, monotonicNowMs())
        if (directive.kind !== "final" || directive.text === null) {
            return null
        }

        return directive.text
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

function monotonicNowMs(): number {
    return Math.trunc(performance.now())
}
