import type { BindingDeferredDeliveryStrategy, BindingDeferredPreviewContext, BindingDeliveryTarget } from "../binding"
import type { TelegramToolCallView } from "../config/telegram"
import type { GatewayTransportHost } from "../host/transport"
import type { SqliteStore } from "../store/sqlite"
import { recordTelegramPreviewEmit, recordTelegramStreamFallback } from "../telegram/state"
import {
    buildTelegramStreamReplyMarkup,
    renderTelegramStreamMessageForView,
    resolveTelegramPreviewViewState,
    type TelegramPreviewViewState,
} from "../telegram/stream-render"
import type { TelegramToolSection } from "../telegram/tool-render"
import type { DeliveryModePreference, TelegramProgressiveSupport } from "./telegram"

export type TextDeliveryPreview = {
    processText: string | null
    reasoningText: string | null
    answerText: string | null
    toolSections?: TelegramToolSection[]
    forceStreamOpen?: boolean
}

export type TextDeliverySession = {
    mode: "oneshot" | "progressive"
    preview(preview: TextDeliveryPreview): Promise<void>
    finish(finalText: string | null): Promise<boolean>
    handoffFinalDelivery(): Promise<TextDeliveryDeferredHandle>
}

export type TextDeliveryOptions = {
    streamOpenDelayMs?: number
    streamEditIntervalMs?: number
    typingKeepaliveIntervalMs?: number
}

export type TargetTextDeliverySession = {
    target: BindingDeliveryTarget
    session: TextDeliverySession
}

export type TextDeliveryDeferredHandle = {
    strategy: BindingDeferredDeliveryStrategy
    previewContext: BindingDeferredPreviewContext | null
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
        private readonly toolCallView: TelegramToolCallView = "toggle",
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
        const sessions = await this.openTargetSessions(targets, preference)
        if (sessions.length === 0) {
            return [new NoopTextDeliverySession()]
        }
        const uniqueSessions = sessions.map((entry) => entry.session)

        if (uniqueSessions.length === 1) {
            return uniqueSessions
        }

        return [new FanoutTextDeliverySession(uniqueSessions)]
    }

    async openTargetSessions(
        targets: BindingDeliveryTarget[],
        preference: DeliveryModePreference,
    ): Promise<TargetTextDeliverySession[]> {
        const uniqueTargets = dedupeTargets(targets)
        if (uniqueTargets.length === 0) {
            return []
        }

        return await Promise.all(
            uniqueTargets.map(async (target) => {
                const mode = await this.telegramSupport.resolveMode(target, preference)
                if (mode === "progressive") {
                    const session = new ProgressiveTextDeliverySession(
                        target,
                        this.transport,
                        this.telegramSupport,
                        this.store,
                        this.toolCallView,
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
                    return { target, session } satisfies TargetTextDeliverySession
                }

                return {
                    target,
                    session: new OneshotTextDeliverySession(target, this.transport),
                } satisfies TargetTextDeliverySession
            }),
        )
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

    async handoffFinalDelivery(): Promise<TextDeliveryDeferredHandle> {
        return {
            strategy: { mode: "send" },
            previewContext: null,
        }
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

    async handoffFinalDelivery(): Promise<TextDeliveryDeferredHandle> {
        const results = await Promise.all(this.sessions.map((session) => session.handoffFinalDelivery()))
        const editHandle = results.find((result) => result.strategy.mode === "edit")
        return editHandle ?? { strategy: { mode: "send" }, previewContext: null }
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

        if (ack.kind !== "delivered") {
            throw new Error(ack.errorMessage)
        }

        return true
    }

    async handoffFinalDelivery(): Promise<TextDeliveryDeferredHandle> {
        return {
            strategy: { mode: "send" },
            previewContext: null,
        }
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
    private lastRenderedReplyMarkupKey: string | null = null
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
        private readonly toolCallView: TelegramToolCallView,
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
                    toolSections: this.latestPreview?.toolSections ?? [],
                })

                if (finalPreview !== null) {
                    try {
                        await this.commitFinalBody(finalPreview)
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

    async handoffFinalDelivery(): Promise<TextDeliveryDeferredHandle> {
        this.acceptingPreviews = false
        this.stopTypingKeepalive()
        this.cancelOpenTimer()
        this.cancelFlushTimer()
        await this.awaitPendingWork()
        this.finished = true

        return {
            strategy:
                this.streamMessageId === null ? { mode: "send" } : { mode: "edit", messageId: this.streamMessageId },
            previewContext: toDeferredPreviewContext(this.latestPreview),
        }
    }

    private scheduleOpenOrFlush(): void {
        if (this.latestPreview === null || this.previewFailed || this.finished) {
            return
        }

        if (this.streamMessageId === null) {
            if (this.latestPreview.forceStreamOpen === true) {
                this.cancelOpenTimer()
                this.requestImmediateFlush()
                return
            }

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
        await this.commitPreview(this.latestPreview)
    }

    private async commitPreview(preview: TextDeliveryPreview): Promise<void> {
        const rendered = this.renderPreview(preview)
        if (
            this.lastRenderedBody === rendered.text &&
            this.lastRenderedReplyMarkupKey === serializeReplyMarkup(rendered.replyMarkup)
        ) {
            return
        }

        try {
            if (this.streamMessageId === null) {
                this.streamMessageId = await this.telegramSupport.sendStreamMessage(
                    this.target,
                    rendered.text,
                    rendered.replyMarkup,
                )
            } else {
                await this.telegramSupport.editStreamMessage(
                    this.target,
                    this.streamMessageId,
                    rendered.text,
                    rendered.replyMarkup,
                )
            }

            this.lastRenderedBody = rendered.text
            this.lastRenderedReplyMarkupKey = serializeReplyMarkup(rendered.replyMarkup)
            this.lastStreamUpdateAtMs = Date.now()
            this.syncPreviewMessageState(preview, rendered.viewState)
        } catch {
            this.previewFailed = true
            this.stopTypingKeepalive()
        }
    }

    private async commitFinalBody(preview: TextDeliveryPreview): Promise<void> {
        if (this.streamMessageId === null) {
            return
        }

        const rendered = this.renderPreview(preview, { viewMode: "preview", previewPage: 0 })
        if (
            this.lastRenderedBody === rendered.text &&
            this.lastRenderedReplyMarkupKey === serializeReplyMarkup(rendered.replyMarkup)
        ) {
            return
        }

        await this.telegramSupport.editStreamMessage(
            this.target,
            this.streamMessageId,
            rendered.text,
            rendered.replyMarkup,
        )
        this.lastRenderedBody = rendered.text
        this.lastRenderedReplyMarkupKey = serializeReplyMarkup(rendered.replyMarkup)
        this.lastStreamUpdateAtMs = Date.now()
        this.syncPreviewMessageState(preview, rendered.viewState)
    }

    private renderPreview(
        preview: TextDeliveryPreview,
        overrideViewState?: Partial<TelegramPreviewViewState>,
    ): {
        text: string
        replyMarkup: ReturnType<typeof buildTelegramStreamReplyMarkup>
        viewState: TelegramPreviewViewState
    } {
        const storedViewState = this.resolveStoredViewState()
        const resolvedViewState = resolveTelegramPreviewViewState(preview, {
            toolCallView: this.toolCallView,
            viewState: {
                viewMode: overrideViewState?.viewMode ?? storedViewState.viewMode,
                previewPage: overrideViewState?.previewPage ?? storedViewState.previewPage,
                toolsPage: overrideViewState?.toolsPage ?? storedViewState.toolsPage,
            },
        })
        const viewState = {
            viewMode: resolvedViewState.viewMode,
            previewPage: resolvedViewState.previewPage,
            toolsPage: resolvedViewState.toolsPage,
        } satisfies TelegramPreviewViewState

        return {
            text: renderTelegramStreamMessageForView(preview, {
                toolCallView: this.toolCallView,
                viewState,
            }),
            replyMarkup: buildTelegramStreamReplyMarkup(preview, {
                toolCallView: this.toolCallView,
                viewState,
            }),
            viewState,
        }
    }

    private resolveStoredViewState(): TelegramPreviewViewState {
        if (this.toolCallView !== "toggle" || this.streamMessageId === null) {
            return {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            }
        }

        const preview = this.store.getTelegramPreviewMessage(this.target.target, this.streamMessageId)
        return (
            preview ?? {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            }
        )
    }

    private syncPreviewMessageState(preview: TextDeliveryPreview, viewState: TelegramPreviewViewState): void {
        if (this.toolCallView !== "toggle" || this.streamMessageId === null) {
            return
        }

        const toolSections = normalizeToolSections(preview.toolSections)
        const resolvedViewState = resolveTelegramPreviewViewState(preview, {
            toolCallView: this.toolCallView,
            viewState,
        })
        if (resolvedViewState.toolCount === 0 && resolvedViewState.previewPageCount <= 1) {
            this.store.deleteTelegramPreviewMessage(this.target.target, this.streamMessageId)
            return
        }

        this.store.upsertTelegramPreviewMessage({
            chatId: this.target.target,
            messageId: this.streamMessageId,
            viewMode: viewState.viewMode,
            previewPage: viewState.previewPage,
            toolsPage: viewState.toolsPage,
            processText: preview.processText,
            reasoningText: preview.reasoningText,
            answerText: preview.answerText,
            toolSections,
            recordedAtMs: Date.now(),
        })
    }

    private async sendFinalOneshot(finalText: string): Promise<boolean> {
        const ack = await this.transport.sendMessage({
            deliveryTarget: this.target,
            body: finalText,
        })

        if (ack.kind !== "delivered") {
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
        return this.acceptingPreviews && !this.finished
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
    const toolSections = normalizeToolSections(preview.toolSections)
    if (processText === null && reasoningText === null && answerText === null && toolSections.length === 0) {
        return null
    }

    return {
        processText,
        reasoningText,
        answerText,
        toolSections,
        forceStreamOpen: preview.forceStreamOpen === true,
    }
}

function toDeferredPreviewContext(preview: TextDeliveryPreview | null): BindingDeferredPreviewContext | null {
    if (preview === null) {
        return null
    }

    const normalized = normalizePreview({
        processText: preview.processText,
        reasoningText: preview.reasoningText,
        answerText: null,
        toolSections: preview.toolSections,
    })
    if (normalized === null) {
        return null
    }

    return {
        processText: normalized.processText,
        reasoningText: normalized.reasoningText,
        toolSections: normalized.toolSections,
    }
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null) {
        return null
    }

    return value.trim().length === 0 ? null : value
}

function serializeReplyMarkup(replyMarkup: ReturnType<typeof buildTelegramStreamReplyMarkup>): string | null {
    return replyMarkup === null ? null : JSON.stringify(replyMarkup)
}

function normalizeToolSections(sections: TelegramToolSection[] | undefined): TelegramToolSection[] {
    if (sections === undefined || sections.length === 0) {
        return []
    }

    return sections.filter((section) => {
        return section.toolName.trim().length > 0 && (section.title === null || section.title.trim().length > 0)
    })
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
