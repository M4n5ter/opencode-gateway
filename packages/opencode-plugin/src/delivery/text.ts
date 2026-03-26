import type { BindingDeliveryTarget } from "../binding"
import type { GatewayTransportHost } from "../host/transport"
import type { SqliteStore } from "../store/sqlite"
import { recordTelegramPreviewEmit, recordTelegramStreamFallback } from "../telegram/state"
import { renderTelegramStreamMessage } from "../telegram/stream-render"
import type { DeliveryModePreference, TelegramProgressiveSupport } from "./telegram"

export type TextDeliveryPreview = {
    processText: string | null
    reasoningText: string | null
    answerText: string | null
}

export type TextDeliverySession = {
    mode: "oneshot" | "progressive"
    preview(preview: TextDeliveryPreview): Promise<void>
    finish(finalText: string | null): Promise<boolean>
}

export type TextDeliveryOptions = {
    streamOpenDelayMs?: number
    streamEditIntervalMs?: number
    typingKeepaliveIntervalMs?: number
}

type ProgressiveTextDeliveryOptions = {
    streamOpenDelayMs: number
    streamEditIntervalMs: number
    typingKeepaliveIntervalMs: number
}

const DEFAULT_STREAM_OPEN_DELAY_MS = 1_200
const DEFAULT_STREAM_EDIT_INTERVAL_MS = 1_000
const DEFAULT_TYPING_KEEPALIVE_INTERVAL_MS = 3_000

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
                        {
                            streamOpenDelayMs:
                                preference === "stream"
                                    ? 0
                                    : (this.options.streamOpenDelayMs ?? DEFAULT_STREAM_OPEN_DELAY_MS),
                            streamEditIntervalMs: this.options.streamEditIntervalMs ?? DEFAULT_STREAM_EDIT_INTERVAL_MS,
                            typingKeepaliveIntervalMs:
                                this.options.typingKeepaliveIntervalMs ?? DEFAULT_TYPING_KEEPALIVE_INTERVAL_MS,
                        },
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
            await session.preview({
                processText: null,
                reasoningText: null,
                answerText: text.slice(0, Math.max(1, Math.ceil(text.length / 2))),
            })
        }

        return {
            delivered: await session.finish(text),
            mode: session.mode,
        }
    }
}

class NoopTextDeliverySession implements TextDeliverySession {
    readonly mode = "oneshot" as const

    async preview(_preview: TextDeliveryPreview): Promise<void> {}

    async finish(_finalText: string | null): Promise<boolean> {
        return false
    }
}

class FanoutTextDeliverySession implements TextDeliverySession {
    readonly mode: "oneshot" | "progressive"

    constructor(private readonly sessions: TextDeliverySession[]) {
        this.mode = sessions.some((session) => session.mode === "progressive") ? "progressive" : "oneshot"
    }

    async preview(preview: TextDeliveryPreview): Promise<void> {
        await Promise.all(this.sessions.map((session) => session.preview(preview)))
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

    async preview(_preview: TextDeliveryPreview): Promise<void> {}

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
    private readonly startedAtMs = Date.now()
    private previewFailed = false
    private acceptingPreviews = true
    private finished = false
    private latestPreview: TextDeliveryPreview | null = null
    private streamMessageId: number | null = null
    private lastRenderedBody: string | null = null
    private lastStreamUpdateAtMs = 0
    private pendingWork = Promise.resolve()
    private openTimer: ReturnType<typeof setTimeout> | null = null
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private typingKeepaliveTimer: ReturnType<typeof setTimeout> | null = null

    constructor(
        private readonly target: BindingDeliveryTarget,
        private readonly transport: GatewayTransportHost,
        private readonly telegramSupport: TelegramProgressiveSupport,
        private readonly store: SqliteStore,
        private readonly options: ProgressiveTextDeliveryOptions,
    ) {}

    start(): void {
        this.telegramSupport.startTyping(this.target)
        this.ensureTypingKeepalive()
    }

    async preview(preview: TextDeliveryPreview): Promise<void> {
        const normalizedPreview = normalizePreview(preview)
        if (this.previewFailed || !this.acceptingPreviews || this.finished || normalizedPreview === null) {
            return
        }

        this.latestPreview = normalizedPreview
        this.scheduleOpenOrFlush()
    }

    async finish(finalText: string | null): Promise<boolean> {
        this.acceptingPreviews = false
        this.stopTypingKeepalive()
        this.cancelOpenTimer()
        this.cancelFlushTimer()
        await this.awaitPendingWork()

        const normalizedFinalText = finalText?.trim() ?? ""
        if (normalizedFinalText.length === 0) {
            this.finished = true
            return false
        }

        try {
            if (!this.previewFailed && this.streamMessageId !== null) {
                const finalPreview = normalizePreview({
                    processText: this.latestPreview?.processText ?? null,
                    reasoningText: this.latestPreview?.reasoningText ?? null,
                    answerText: normalizedFinalText,
                })

                if (finalPreview !== null) {
                    try {
                        await this.commitFinalBody(renderTelegramStreamMessage(finalPreview))
                        return true
                    } catch {
                        recordTelegramStreamFallback(this.store, "stream_edit_failed", Date.now())
                    }
                }
            }

            if (!this.previewFailed && this.streamMessageId === null) {
                recordTelegramStreamFallback(this.store, "preview_not_established", Date.now())
            }

            return await this.sendFinalOneshot(normalizedFinalText)
        } finally {
            this.finished = true
            this.stopTypingKeepalive()
            this.cancelOpenTimer()
            this.cancelFlushTimer()
        }
    }

    private scheduleOpenOrFlush(): void {
        if (this.latestPreview === null || this.previewFailed || this.finished) {
            return
        }

        if (this.streamMessageId === null) {
            const elapsedMs = Date.now() - this.startedAtMs
            if (elapsedMs >= this.options.streamOpenDelayMs) {
                this.cancelOpenTimer()
                this.requestImmediateFlush()
                return
            }

            if (this.openTimer !== null) {
                return
            }

            this.openTimer = setTimeout(() => {
                this.openTimer = null
                this.requestImmediateFlush()
            }, this.options.streamOpenDelayMs - elapsedMs)
            return
        }

        this.scheduleEditFlush()
    }

    private requestImmediateFlush(): void {
        if (this.latestPreview === null || this.previewFailed || this.finished) {
            return
        }

        this.cancelFlushTimer()
        void this.enqueueWork(async () => {
            await this.flushLatestPreview()
        })
    }

    private scheduleEditFlush(): void {
        if (this.flushTimer !== null) {
            return
        }

        const remainingMs = Math.max(0, this.options.streamEditIntervalMs - (Date.now() - this.lastStreamUpdateAtMs))
        if (remainingMs === 0) {
            this.requestImmediateFlush()
            return
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            this.requestImmediateFlush()
        }, remainingMs)
    }

    private async flushLatestPreview(): Promise<void> {
        if (this.previewFailed || this.finished || this.latestPreview === null) {
            return
        }

        recordTelegramPreviewEmit(this.store, Date.now())
        await this.commitPreviewBody(renderTelegramStreamMessage(this.latestPreview))
    }

    private async commitPreviewBody(body: string): Promise<void> {
        if (this.lastRenderedBody === body) {
            return
        }

        try {
            if (this.streamMessageId === null) {
                this.streamMessageId = await this.telegramSupport.sendStreamMessage(this.target, body)
                this.stopTypingKeepalive()
            } else {
                await this.telegramSupport.editStreamMessage(this.target, this.streamMessageId, body)
            }

            this.lastRenderedBody = body
            this.lastStreamUpdateAtMs = Date.now()
        } catch {
            this.previewFailed = true
            this.stopTypingKeepalive()
        }
    }

    private async commitFinalBody(body: string): Promise<void> {
        if (this.streamMessageId === null || this.lastRenderedBody === body) {
            return
        }

        await this.telegramSupport.editStreamMessage(this.target, this.streamMessageId, body)
        this.lastRenderedBody = body
        this.lastStreamUpdateAtMs = Date.now()
    }

    private async sendFinalOneshot(finalText: string): Promise<boolean> {
        const ack = await this.transport.sendMessage({
            deliveryTarget: this.target,
            body: finalText,
        })

        if (ack.errorMessage !== null) {
            throw new Error(ack.errorMessage)
        }

        return true
    }

    private async awaitPendingWork(): Promise<void> {
        await this.pendingWork
    }

    private enqueueWork(task: () => Promise<void>): Promise<void> {
        const run = async (): Promise<void> => {
            await task()
        }

        this.pendingWork = this.pendingWork.then(run, run)
        return this.pendingWork
    }

    private ensureTypingKeepalive(): void {
        if (!this.shouldKeepTyping() || this.typingKeepaliveTimer !== null) {
            return
        }

        this.typingKeepaliveTimer = setTimeout(() => {
            this.typingKeepaliveTimer = null
            if (!this.shouldKeepTyping()) {
                return
            }

            this.telegramSupport.startTyping(this.target)
            this.ensureTypingKeepalive()
        }, this.options.typingKeepaliveIntervalMs)
    }

    private stopTypingKeepalive(): void {
        if (this.typingKeepaliveTimer === null) {
            return
        }

        clearTimeout(this.typingKeepaliveTimer)
        this.typingKeepaliveTimer = null
    }

    private shouldKeepTyping(): boolean {
        return this.acceptingPreviews && !this.finished && this.streamMessageId === null
    }

    private cancelOpenTimer(): void {
        if (this.openTimer === null) {
            return
        }

        clearTimeout(this.openTimer)
        this.openTimer = null
    }

    private cancelFlushTimer(): void {
        if (this.flushTimer === null) {
            return
        }

        clearTimeout(this.flushTimer)
        this.flushTimer = null
    }
}

function normalizePreview(preview: TextDeliveryPreview): TextDeliveryPreview | null {
    const processText = normalizeVisibleText(preview.processText)
    const reasoningText = normalizeVisibleText(preview.reasoningText)
    const answerText = normalizeVisibleText(preview.answerText)
    if (processText === null && reasoningText === null && answerText === null) {
        return null
    }

    return {
        processText,
        reasoningText,
        answerText,
    }
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null) {
        return null
    }

    return value.trim().length === 0 ? null : value
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
