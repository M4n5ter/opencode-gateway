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

export type GatewayTelegramStatus = TelegramHealthSnapshot & {
    enabled: boolean
    polling: boolean
    allowlistMode: "disabled" | "explicit"
    allowedChatsCount: number
    allowedUsersCount: number
    liveProbe: "disabled" | "ok" | "failed"
    liveProbeError: string | null
    liveBotId: string | null
    liveBotUsername: string | null
    streamingEnabled: boolean
}

export type TelegramSendTestResult = {
    chatId: string
    topic: string | null
    text: string
    sentAtMs: number
    mode: "oneshot" | "progressive"
}

type TelegramTextDeliveryLike = Pick<GatewayTextDelivery, "sendTest">

export class GatewayTelegramRuntime {
    constructor(
        private readonly client: TelegramRuntimeClientLike | null,
        private readonly delivery: TelegramTextDeliveryLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: TelegramConfig,
        private readonly polling: TelegramPollingService | null,
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
                allowlistMode: "disabled",
                allowedChatsCount: 0,
                allowedUsersCount: 0,
                liveProbe: "disabled",
                liveProbeError: null,
                liveBotId: null,
                liveBotUsername: null,
                streamingEnabled: false,
            }
        }

        try {
            const bot = await this.client.getMe()
            const recordedAtMs = Date.now()
            recordTelegramProbeSuccess(this.store, bot, recordedAtMs)

            return buildEnabledStatus(
                this.config,
                readTelegramHealthSnapshot(this.store),
                this.isPolling(),
                "ok",
                null,
                bot,
            )
        } catch (error) {
            const message = formatError(error)
            const recordedAtMs = Date.now()
            recordTelegramProbeFailure(this.store, message, recordedAtMs)
            this.logger.log("warn", `telegram live probe failed: ${message}`)

            return buildEnabledStatus(
                this.config,
                readTelegramHealthSnapshot(this.store),
                this.isPolling(),
                "failed",
                message,
                null,
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
    polling: boolean,
    liveProbe: "ok" | "failed",
    liveProbeError: string | null,
    bot: TelegramBotProfile | null,
): GatewayTelegramStatus {
    return {
        ...snapshot,
        enabled: true,
        polling,
        allowlistMode: "explicit",
        allowedChatsCount: config.allowedChats.length,
        allowedUsersCount: config.allowedUsers.length,
        liveProbe,
        liveProbeError,
        liveBotId: bot ? String(bot.id) : null,
        liveBotUsername: bot?.username ?? null,
        streamingEnabled: true,
    }
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
