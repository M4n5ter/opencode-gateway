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

export type TextDeliveryOptions = {
    progressiveRefreshIntervalMs?: number
}

const DEFAULT_PROGRESSIVE_REFRESH_INTERVAL_MS = 3_000

export class GatewayTextDelivery {
    constructor(
        private readonly transport: GatewayTransportHost,
        private readonly store: SqliteStore,
        private readonly telegramSupport: TelegramProgressiveSupport,
        private readonly options: TextDeliveryOptions = {},
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
                        this.options.progressiveRefreshIntervalMs ?? DEFAULT_PROGRESSIVE_REFRESH_INTERVAL_MS,
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
    private acceptingPreviews = true
    private finished = false
    private latestPreviewText: string | null = null
    private pendingPreviewCount = 0
    private pendingPreview = Promise.resolve()
    private keepaliveTimer: ReturnType<typeof setTimeout> | null = null
    private readonly draftId = createDraftId()

    constructor(
        private readonly target: BindingDeliveryTarget,
        private readonly transport: GatewayTransportHost,
        private readonly telegramSupport: TelegramProgressiveSupport,
        private readonly store: SqliteStore,
        private readonly refreshIntervalMs: number,
    ) {}

    start(): void {
        this.telegramSupport.startTyping(this.target)
        this.ensureKeepalive()
    }

    async preview(text: string): Promise<void> {
        if (this.previewFailed || !this.acceptingPreviews || this.finished || text.trim().length === 0) {
            return
        }

        this.latestPreviewText = text
        await this.enqueueDraftSend(() => this.latestPreviewText, true)

        if (!this.previewFailed && this.previewDelivered) {
            this.ensureKeepalive()
        }
    }

    async finish(finalText: string | null): Promise<boolean> {
        this.acceptingPreviews = false
        this.stopKeepalive()
        await this.awaitPendingPreview()

        const normalizedFinalText = finalText?.trim() ?? ""
        if (normalizedFinalText.length === 0) {
            this.finished = true
            return false
        }

        if (!this.previewDelivered && !this.previewFailed) {
            recordTelegramStreamFallback(this.store, "preview_not_established", Date.now())
        }

        if (this.previewDelivered && !this.previewFailed && this.latestPreviewText !== normalizedFinalText) {
            this.latestPreviewText = normalizedFinalText
            await this.enqueueDraftSend(() => this.latestPreviewText, false)
        }

        try {
            const ack = await this.transport.sendMessage({
                deliveryTarget: this.target,
                body: normalizedFinalText,
            })

            if (ack.errorMessage !== null) {
                throw new Error(ack.errorMessage)
            }

            return true
        } finally {
            this.finished = true
            this.stopKeepalive()
        }
    }

    private async enqueueDraftSend(getText: () => string | null, recordEmit: boolean): Promise<void> {
        const runPreview = async (): Promise<void> => {
            try {
                if (this.finished || this.previewFailed) {
                    return
                }

                const text = getText()
                if (text === null || text.trim().length === 0) {
                    return
                }

                try {
                    if (recordEmit) {
                        recordTelegramPreviewEmit(this.store, Date.now())
                    }
                    await this.telegramSupport.sendDraft(this.target, this.draftId, text)
                    this.previewDelivered = true
                } catch {
                    this.previewFailed = true
                    this.stopKeepalive()
                }
            } finally {
                this.pendingPreviewCount = Math.max(0, this.pendingPreviewCount - 1)
            }
        }

        this.pendingPreviewCount += 1
        this.pendingPreview = this.pendingPreview.then(runPreview, runPreview)
        await this.pendingPreview
    }

    private async awaitPendingPreview(): Promise<void> {
        if (this.pendingPreviewCount > 0) {
            await this.pendingPreview
        }
    }

    private ensureKeepalive(): void {
        if (!this.shouldKeepalive() || this.keepaliveTimer !== null) {
            return
        }

        this.keepaliveTimer = setTimeout(() => {
            this.keepaliveTimer = null
            if (!this.shouldKeepalive()) {
                return
            }

            this.telegramSupport.startTyping(this.target)
            const keepaliveWork =
                this.previewDelivered && !this.previewFailed && this.latestPreviewText !== null
                    ? this.enqueueDraftSend(() => this.latestPreviewText, false)
                    : Promise.resolve()

            void keepaliveWork.finally(() => {
                if (this.shouldKeepalive()) {
                    this.ensureKeepalive()
                }
            })
        }, this.refreshIntervalMs)
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimer === null) {
            return
        }

        clearTimeout(this.keepaliveTimer)
        this.keepaliveTimer = null
    }

    private shouldKeepalive(): boolean {
        return this.acceptingPreviews && !this.finished
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
