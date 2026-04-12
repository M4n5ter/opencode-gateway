import type { BindingLoggerHost } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { GatewayMailboxRouter } from "../mailbox/router"
import type { GatewayMailboxRuntime } from "../runtime/mailbox"
import type { SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import { TelegramApiError, type TelegramPollingClientLike } from "./client"
import type { TelegramInboundMediaStore } from "./media"
import {
    buildTelegramAllowlist,
    normalizeTelegramUpdate,
    type TelegramBotIdentity,
    type TelegramNormalizedCallbackQuery,
} from "./normalize"
import {
    recordTelegramChatType,
    recordTelegramPollCompleted,
    recordTelegramPollFailure,
    recordTelegramPollStarted,
    recordTelegramPollSuccess,
    recordTelegramPollTimeout,
} from "./state"

const POLL_TIMEOUT_FLOOR_MS = 15_000
const POLL_TIMEOUT_GRACE_MS = 10_000
const POLL_STALL_GRACE_MS = 5_000
const UNKNOWN_BOT_IDENTITY: TelegramBotIdentity = {
    id: "",
    username: null,
}

type PollerTiming = {
    timeoutFloorMs: number
    timeoutGraceMs: number
    stallGraceMs: number
}

export class TelegramPollingService {
    private readonly allowlist
    private readonly timing: PollerTiming
    private botIdentity: TelegramBotIdentity | null
    private running = false
    private inFlightStartedAtMs: number | null = null
    private consecutiveFailures = 0
    private recoveredAtMs: number | null = null

    constructor(
        private readonly client: TelegramPollingClientLike,
        private readonly mailbox: GatewayMailboxRuntimeLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: Extract<TelegramConfig, { enabled: true }>,
        botIdentity: TelegramBotIdentity | null,
        private readonly mailboxRouter: MailboxRouterLike,
        private readonly mediaStore: TelegramInboundMediaStoreLike,
        private readonly callbackHandlers: TelegramCallbackRuntimeLike[],
        timing?: Partial<PollerTiming>,
    ) {
        this.allowlist = buildTelegramAllowlist(config)
        this.botIdentity = botIdentity
        this.timing = {
            timeoutFloorMs: timing?.timeoutFloorMs ?? POLL_TIMEOUT_FLOOR_MS,
            timeoutGraceMs: timing?.timeoutGraceMs ?? POLL_TIMEOUT_GRACE_MS,
            stallGraceMs: timing?.stallGraceMs ?? POLL_STALL_GRACE_MS,
        }
    }

    start(): void {
        if (this.running) {
            return
        }

        this.running = true
        void this.runLoop().finally(() => {
            this.running = false
        })
    }

    isRunning(): boolean {
        return this.running
    }

    currentPollStartedAtMs(): number | null {
        return this.inFlightStartedAtMs
    }

    requestTimeoutMs(): number {
        return Math.max(this.config.pollTimeoutSeconds * 1_000 + this.timing.timeoutGraceMs, this.timing.timeoutFloorMs)
    }

    recoveryRecordedAtMs(): number | null {
        return this.recoveredAtMs
    }

    private async runLoop(): Promise<void> {
        let offset = this.store.getTelegramUpdateOffset()
        let retryDelayMs = 1_000

        for (;;) {
            const pollStartedAtMs = Date.now()
            recordTelegramPollStarted(this.store, pollStartedAtMs)

            const controller = new AbortController()
            const timeoutHandle = setTimeout(() => {
                controller.abort()
            }, this.requestTimeoutMs() + this.timing.stallGraceMs)
            this.inFlightStartedAtMs = pollStartedAtMs

            try {
                await this.ensureBotIdentity()
                const updates = await this.client.getUpdates(offset, this.config.pollTimeoutSeconds, controller.signal)
                const recordedAtMs = Date.now()
                recordTelegramPollCompleted(this.store, recordedAtMs)
                recordTelegramPollSuccess(this.store, recordedAtMs)

                if (this.consecutiveFailures > 0) {
                    this.recoveredAtMs = recordedAtMs
                    this.logger.log(
                        "info",
                        `telegram poller recovered after ${this.consecutiveFailures} consecutive failure(s)`,
                    )
                }

                for (const update of updates) {
                    const nextOffset = update.update_id + 1
                    const normalized = normalizeTelegramUpdate(
                        update,
                        this.allowlist,
                        this.botIdentity ?? UNKNOWN_BOT_IDENTITY,
                        this.mailboxRouter,
                    )

                    if (normalized.kind === "ignore") {
                        this.logger.log("debug", `ignoring telegram update ${update.update_id}: ${normalized.reason}`)
                        this.logger.log("debug", formatIgnoredTelegramUpdateDetails(update))
                        offset = this.advanceOffset(nextOffset)
                        continue
                    }

                    if (this.store.hasMailboxEntry("telegram_update", String(update.update_id))) {
                        offset = this.advanceOffset(nextOffset)
                        continue
                    }

                    if (normalized.kind === "callbackQuery") {
                        for (const handler of this.callbackHandlers) {
                            if (await handler.handleTelegramCallbackQuery(normalized.callbackQuery)) {
                                break
                            }
                        }
                        offset = this.advanceOffset(nextOffset)
                        continue
                    }

                    recordTelegramChatType(
                        this.store,
                        normalized.message.deliveryTarget.target,
                        normalized.chatType,
                        Date.now(),
                    )
                    await this.mailbox.enqueueInboundMessage(
                        await this.mediaStore.materializeInboundMessage(
                            normalized.message,
                            "telegram_update",
                            String(update.update_id),
                        ),
                        "telegram_update",
                        String(update.update_id),
                    )
                    offset = this.advanceOffset(nextOffset)
                }

                this.consecutiveFailures = 0
                retryDelayMs = 1_000
            } catch (error) {
                const recordedAtMs = Date.now()
                recordTelegramPollCompleted(this.store, recordedAtMs)
                const pollError = classifyTelegramPollError(error, this.requestTimeoutMs())
                this.consecutiveFailures += 1

                if (pollError.kind === "timeout") {
                    recordTelegramPollTimeout(this.store, pollError.message, recordedAtMs)
                } else {
                    recordTelegramPollFailure(this.store, pollError.message, recordedAtMs)
                }

                if (isPermanentTelegramFailure(error)) {
                    this.logger.log("error", pollError.message)
                    return
                }

                this.logger.log("warn", pollError.message)
                await sleep(retryDelayMs)
                retryDelayMs = Math.min(retryDelayMs * 2, 15_000)
            } finally {
                clearTimeout(timeoutHandle)
                this.inFlightStartedAtMs = null
            }
        }
    }

    private advanceOffset(offset: number): number {
        const recordedAtMs = Date.now()

        this.store.putTelegramUpdateOffset(offset, recordedAtMs)
        return offset
    }

    private async ensureBotIdentity(): Promise<void> {
        if (this.botIdentity !== null) {
            return
        }

        const bot = await this.client.getMe()
        this.botIdentity = {
            id: String(bot.id),
            username: bot.username ?? null,
        }
    }
}

type GatewayMailboxRuntimeLike = Pick<GatewayMailboxRuntime, "enqueueInboundMessage">
type MailboxRouterLike = Pick<GatewayMailboxRouter, "resolve">
type TelegramInboundMediaStoreLike = Pick<TelegramInboundMediaStore, "materializeInboundMessage">
type TelegramCallbackRuntimeLike = {
    handleTelegramCallbackQuery(query: TelegramNormalizedCallbackQuery): Promise<boolean>
}

function isPermanentTelegramFailure(error: unknown): boolean {
    return error instanceof TelegramApiError && !error.retryable
}

function formatTelegramPollerError(error: unknown): string {
    return `telegram poller failure: ${formatError(error)}`
}

function classifyTelegramPollError(
    error: unknown,
    requestTimeoutMs: number,
): { kind: "timeout" | "error"; message: string } {
    if (isAbortError(error)) {
        return {
            kind: "timeout",
            message: `telegram poller timeout after ${requestTimeoutMs}ms`,
        }
    }

    return {
        kind: "error",
        message: formatTelegramPollerError(error),
    }
}

function isAbortError(error: unknown): boolean {
    if (error instanceof DOMException) {
        return error.name === "AbortError"
    }

    if (error instanceof Error) {
        return error.name === "AbortError"
    }

    return false
}

function sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}

function formatIgnoredTelegramUpdateDetails(update: {
    update_id: number
    message?: {
        from?: { id: number; is_bot?: boolean }
        chat: { id: number; type: string }
        text?: string
        caption?: string
        entities?: Array<{ type: string; offset: number; length: number }>
        caption_entities?: Array<{ type: string; offset: number; length: number }>
    }
}): string {
    const message = update.message
    if (!message) {
        return `telegram update ${update.update_id} details: no message payload`
    }

    const entitySummary = summarizeTelegramEntities(message.entities ?? message.caption_entities)
    const text = message.text ?? message.caption ?? null

    return [
        `telegram update ${update.update_id} details:`,
        `chat_id=${message.chat.id}`,
        `chat_type=${message.chat.type}`,
        `from_id=${message.from?.id ?? "none"}`,
        `from_is_bot=${message.from?.is_bot === true}`,
        `text=${JSON.stringify(text)}`,
        `entities=${entitySummary}`,
    ].join(" ")
}

function summarizeTelegramEntities(
    entities: Array<{ type: string; offset: number; length: number }> | undefined,
): string {
    if (!entities || entities.length === 0) {
        return "[]"
    }

    return JSON.stringify(
        entities.map((entity) => ({
            type: entity.type,
            offset: entity.offset,
            length: entity.length,
        })),
    )
}
