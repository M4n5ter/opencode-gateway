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
        const [session] = await this.openMany([target], preference)
        return session
    }

    async openMany(
        targets: BindingDeliveryTarget[],
        preference: DeliveryModePreference,
    ): Promise<TextDeliverySession[]> {
        const uniqueTargets = dedupeTargets(targets)
        if (uniqueTargets.length === 0) {
            return [new NoopTextDeliverySession()]
        }

        const sessions = await Promise.all(
            uniqueTargets.map(async (target) => {
                const mode = await this.telegramSupport.resolveMode(target, preference)
                if (mode === "progressive") {
                    const session = new ProgressiveTextDeliverySession(
                        target,
                        this.transport,
                        this.telegramSupport,
                        this.store,
                    )
                    session.start()
                    return session
                }

                return new OneshotTextDeliverySession(target, this.transport)
            }),
        )

        if (sessions.length === 1) {
            return sessions
        }

        return [new FanoutTextDeliverySession(sessions)]
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
}

class NoopTextDeliverySession implements TextDeliverySession {
    readonly mode = "oneshot" as const

    async preview(_text: string): Promise<void> {}

    async finish(_finalText: string | null): Promise<boolean> {
        return false
    }
}

class FanoutTextDeliverySession implements TextDeliverySession {
    readonly mode: "oneshot" | "progressive"

    constructor(private readonly sessions: TextDeliverySession[]) {
        this.mode = sessions.some((session) => session.mode === "progressive") ? "progressive" : "oneshot"
    }

    async preview(text: string): Promise<void> {
        await Promise.all(this.sessions.map((session) => session.preview(text)))
    }

    async finish(finalText: string | null): Promise<boolean> {
        const results = await Promise.allSettled(this.sessions.map((session) => session.finish(finalText)))
        const firstFailure = results.find((result) => result.status === "rejected")
        if (firstFailure?.status === "rejected") {
            throw firstFailure.reason
        }

        return results.some((result) => result.status === "fulfilled" && result.value)
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
        if (this.previewFailed || this.closed || text.trim().length === 0) {
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

        if (!this.previewDelivered && !this.previewFailed) {
            recordTelegramStreamFallback(this.store, "preview_not_established", Date.now())
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

function dedupeTargets(targets: BindingDeliveryTarget[]): BindingDeliveryTarget[] {
    const seen = new Set<string>()
    const unique: BindingDeliveryTarget[] = []

    for (const target of targets) {
        const key = `${target.channel}:${target.target}:${target.topic ?? ""}`
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        unique.push(target)
    }

    return unique
}
