import type { BindingLoggerHost } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { DeliveryModePreference } from "../delivery/telegram"
import type { GatewayTextDelivery } from "../delivery/text"
import type { SqliteStore } from "../store/sqlite"
import { formatUnixMsAsUtc } from "../tools/time"
import { formatError } from "../utils/error"
import type { TelegramRuntimeClientLike } from "./client"
import type { TelegramPollingService } from "./poller"
import {
    readTelegramHealthSnapshot,
    recordTelegramProbeFailure,
    recordTelegramProbeSuccess,
    recordTelegramSendFailure,
    type TelegramHealthSnapshot,
} from "./state"
import type { TelegramBotProfile } from "./types"

type EnabledTelegramConfig = Extract<TelegramConfig, { enabled: true }>
type OpencodeEventStreamLike = {
    isConnected(): boolean
    lastStreamError(): string | null
}

export type GatewayTelegramStatus = TelegramHealthSnapshot & {
    enabled: boolean
    polling: boolean
    pollState: "disabled" | "idle" | "running" | "stalled" | "recovering"
    allowlistMode: "disabled" | "explicit"
    allowedChatsCount: number
    allowedUsersCount: number
    liveProbe: "disabled" | "ok" | "failed"
    liveProbeError: string | null
    liveBotId: string | null
    liveBotUsername: string | null
    streamingEnabled: boolean
    opencodeEventStreamConnected: boolean
    lastEventStreamError: string | null
}

export type TelegramSendTestResult = {
    chatId: string
    topic: string | null
    text: string
    sentAtMs: number
    mode: "oneshot" | "progressive"
}

type TelegramTextDeliveryLike = Pick<GatewayTextDelivery, "sendTest">
type TelegramPollingStateLike = Pick<
    TelegramPollingService,
    "currentPollStartedAtMs" | "isRunning" | "recoveryRecordedAtMs" | "requestTimeoutMs" | "start"
>

const RECENT_RECOVERY_WINDOW_MS = 60_000
const POLL_STALLED_GRACE_MS = 5_000

export class GatewayTelegramRuntime {
    constructor(
        private readonly client: TelegramRuntimeClientLike | null,
        private readonly delivery: TelegramTextDeliveryLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: TelegramConfig,
        private readonly polling: TelegramPollingStateLike | null,
        private readonly opencodeEvents: OpencodeEventStreamLike,
    ) {}

    isEnabled(): boolean {
        return this.config.enabled
    }

    isPolling(): boolean {
        return this.polling?.isRunning() ?? false
    }

    allowlistMode(): "disabled" | "explicit" {
        return this.config.enabled ? "explicit" : "disabled"
    }

    start(): void {
        this.polling?.start()
    }

    async status(): Promise<GatewayTelegramStatus> {
        const snapshot = readTelegramHealthSnapshot(this.store)
        if (!this.config.enabled || this.client === null) {
            return {
                ...snapshot,
                enabled: false,
                polling: false,
                pollState: "disabled",
                allowlistMode: "disabled",
                allowedChatsCount: 0,
                allowedUsersCount: 0,
                liveProbe: "disabled",
                liveProbeError: null,
                liveBotId: null,
                liveBotUsername: null,
                streamingEnabled: false,
                opencodeEventStreamConnected: this.opencodeEvents.isConnected(),
                lastEventStreamError: this.opencodeEvents.lastStreamError(),
            }
        }

        try {
            const bot = await this.client.getMe()
            const recordedAtMs = Date.now()
            recordTelegramProbeSuccess(this.store, bot, recordedAtMs)

            return buildEnabledStatus(
                this.config,
                readTelegramHealthSnapshot(this.store),
                this.polling,
                "ok",
                null,
                bot,
                this.opencodeEvents,
            )
        } catch (error) {
            const message = formatError(error)
            const recordedAtMs = Date.now()
            recordTelegramProbeFailure(this.store, message, recordedAtMs)
            this.logger.log("warn", `telegram live probe failed: ${message}`)

            return buildEnabledStatus(
                this.config,
                readTelegramHealthSnapshot(this.store),
                this.polling,
                "failed",
                message,
                null,
                this.opencodeEvents,
            )
        }
    }

    async sendTest(
        chatId: string,
        topic: string | null,
        text: string | null,
        mode: DeliveryModePreference,
    ): Promise<TelegramSendTestResult> {
        const normalizedChatId = normalizeRequiredField(chatId, "chat_id")
        const normalizedTopic = normalizeOptionalField(topic)
        const body = normalizeOptionalField(text) ?? defaultTestMessage()

        if (!this.config.enabled || this.client === null) {
            throw new Error("telegram is not enabled")
        }

        try {
            const sentAtMs = Date.now()
            const result = await this.delivery.sendTest(
                {
                    channel: "telegram",
                    target: normalizedChatId,
                    topic: normalizedTopic,
                },
                body,
                mode,
            )

            if (!result.delivered) {
                throw new Error("telegram test delivery produced no final message")
            }

            return {
                chatId: normalizedChatId,
                topic: normalizedTopic,
                text: body,
                sentAtMs,
                mode: result.mode,
            }
        } catch (error) {
            const message = formatError(error)
            recordTelegramSendFailure(this.store, message, Date.now())
            this.logger.log("warn", `telegram_send_test failed: ${message}`)
            throw error
        }
    }
}

function buildEnabledStatus(
    config: EnabledTelegramConfig,
    snapshot: TelegramHealthSnapshot,
    polling: TelegramPollingStateLike | null,
    liveProbe: "ok" | "failed",
    liveProbeError: string | null,
    bot: TelegramBotProfile | null,
    opencodeEvents: OpencodeEventStreamLike,
): GatewayTelegramStatus {
    const pollingEnabled = polling?.isRunning() ?? false

    return {
        ...snapshot,
        enabled: true,
        polling: pollingEnabled,
        pollState: resolvePollState(snapshot, polling),
        allowlistMode: "explicit",
        allowedChatsCount: config.allowedChats.length,
        allowedUsersCount: config.allowedUsers.length,
        liveProbe,
        liveProbeError,
        liveBotId: bot ? String(bot.id) : null,
        liveBotUsername: bot?.username ?? null,
        streamingEnabled: true,
        opencodeEventStreamConnected: opencodeEvents.isConnected(),
        lastEventStreamError: opencodeEvents.lastStreamError(),
    }
}

function resolvePollState(
    snapshot: TelegramHealthSnapshot,
    polling: TelegramPollingStateLike | null,
): GatewayTelegramStatus["pollState"] {
    if (polling === null || !polling.isRunning()) {
        return "idle"
    }

    const now = Date.now()
    const inFlightStartedAtMs = polling.currentPollStartedAtMs()
    if (
        inFlightStartedAtMs !== null &&
        now - inFlightStartedAtMs > polling.requestTimeoutMs() + POLL_STALLED_GRACE_MS
    ) {
        return "stalled"
    }

    const recoveredAtMs = polling.recoveryRecordedAtMs()
    if (recoveredAtMs !== null && now - recoveredAtMs <= RECENT_RECOVERY_WINDOW_MS) {
        return "recovering"
    }

    if (snapshot.lastPollStartedMs !== null) {
        return "running"
    }

    return "idle"
}

function normalizeRequiredField(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function normalizeOptionalField(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function defaultTestMessage(): string {
    const recordedAtMs = Date.now()
    return `opencode-gateway telegram_send_test at ${formatUnixMsAsUtc(recordedAtMs)}`
}
