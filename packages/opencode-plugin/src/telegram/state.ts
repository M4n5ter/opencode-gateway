import type { SqliteStore } from "../store/sqlite"
import type { TelegramBotProfile, TelegramChatType } from "./types"

const TELEGRAM_UPDATE_OFFSET_KEY = "telegram.update_offset"
const TELEGRAM_LAST_POLL_SUCCESS_MS_KEY = "telegram.last_poll_success_ms"
const TELEGRAM_LAST_POLL_STARTED_MS_KEY = "telegram.last_poll_started_ms"
const TELEGRAM_LAST_POLL_COMPLETED_MS_KEY = "telegram.last_poll_completed_ms"
const TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY = "telegram.last_poll_error_at_ms"
const TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY = "telegram.last_poll_error_message"
const TELEGRAM_LAST_POLL_TIMEOUT_AT_MS_KEY = "telegram.last_poll_timeout_at_ms"
const TELEGRAM_LAST_POLL_TIMEOUT_MESSAGE_KEY = "telegram.last_poll_timeout_message"
const TELEGRAM_LAST_SEND_SUCCESS_MS_KEY = "telegram.last_send_success_ms"
const TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY = "telegram.last_send_error_at_ms"
const TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY = "telegram.last_send_error_message"
const TELEGRAM_LAST_PROBE_SUCCESS_MS_KEY = "telegram.last_probe_success_ms"
const TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY = "telegram.last_probe_error_at_ms"
const TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY = "telegram.last_probe_error_message"
const TELEGRAM_LAST_BOT_ID_KEY = "telegram.last_bot_id"
const TELEGRAM_LAST_BOT_USERNAME_KEY = "telegram.last_bot_username"
const TELEGRAM_LAST_STREAM_SUCCESS_MS_KEY = "telegram.last_stream_success_ms"
const TELEGRAM_LAST_STREAM_ERROR_AT_MS_KEY = "telegram.last_stream_error_at_ms"
const TELEGRAM_LAST_STREAM_ERROR_MESSAGE_KEY = "telegram.last_stream_error_message"
const TELEGRAM_LAST_PREVIEW_EMIT_MS_KEY = "telegram.last_preview_emit_ms"
const TELEGRAM_LAST_STREAM_FALLBACK_AT_MS_KEY = "telegram.last_stream_fallback_at_ms"
const TELEGRAM_LAST_STREAM_FALLBACK_REASON_KEY = "telegram.last_stream_fallback_reason"

export type TelegramStreamingFallbackReason =
    | "non_private_chat"
    | "stream_send_failed"
    | "stream_edit_failed"
    | "preview_not_established"

export type TelegramHealthSnapshot = {
    updateOffset: number | null
    lastPollSuccessMs: number | null
    lastPollStartedMs: number | null
    lastPollCompletedMs: number | null
    lastPollErrorAtMs: number | null
    lastPollErrorMessage: string | null
    lastPollTimeoutAtMs: number | null
    lastPollTimeoutMessage: string | null
    lastSendSuccessMs: number | null
    lastSendErrorAtMs: number | null
    lastSendErrorMessage: string | null
    lastProbeSuccessMs: number | null
    lastProbeErrorAtMs: number | null
    lastProbeErrorMessage: string | null
    lastBotId: string | null
    lastBotUsername: string | null
    lastStreamSuccessMs: number | null
    lastStreamErrorAtMs: number | null
    lastStreamErrorMessage: string | null
    lastPreviewEmitMs: number | null
    lastStreamFallbackAtMs: number | null
    lastStreamFallbackReason: TelegramStreamingFallbackReason | null
}

export function readTelegramHealthSnapshot(store: SqliteStore): TelegramHealthSnapshot {
    return {
        updateOffset: readStoredInteger(store, TELEGRAM_UPDATE_OFFSET_KEY),
        lastPollSuccessMs: readStoredInteger(store, TELEGRAM_LAST_POLL_SUCCESS_MS_KEY),
        lastPollStartedMs: readStoredInteger(store, TELEGRAM_LAST_POLL_STARTED_MS_KEY),
        lastPollCompletedMs: readStoredInteger(store, TELEGRAM_LAST_POLL_COMPLETED_MS_KEY),
        lastPollErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY),
        lastPollErrorMessage: readStoredText(store, TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY),
        lastPollTimeoutAtMs: readStoredInteger(store, TELEGRAM_LAST_POLL_TIMEOUT_AT_MS_KEY),
        lastPollTimeoutMessage: readStoredText(store, TELEGRAM_LAST_POLL_TIMEOUT_MESSAGE_KEY),
        lastSendSuccessMs: readStoredInteger(store, TELEGRAM_LAST_SEND_SUCCESS_MS_KEY),
        lastSendErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY),
        lastSendErrorMessage: readStoredText(store, TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY),
        lastProbeSuccessMs: readStoredInteger(store, TELEGRAM_LAST_PROBE_SUCCESS_MS_KEY),
        lastProbeErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY),
        lastProbeErrorMessage: readStoredText(store, TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY),
        lastBotId: readStoredText(store, TELEGRAM_LAST_BOT_ID_KEY),
        lastBotUsername: readStoredText(store, TELEGRAM_LAST_BOT_USERNAME_KEY),
        lastStreamSuccessMs: readStoredInteger(store, TELEGRAM_LAST_STREAM_SUCCESS_MS_KEY),
        lastStreamErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_STREAM_ERROR_AT_MS_KEY),
        lastStreamErrorMessage: readStoredText(store, TELEGRAM_LAST_STREAM_ERROR_MESSAGE_KEY),
        lastPreviewEmitMs: readStoredInteger(store, TELEGRAM_LAST_PREVIEW_EMIT_MS_KEY),
        lastStreamFallbackAtMs: readStoredInteger(store, TELEGRAM_LAST_STREAM_FALLBACK_AT_MS_KEY),
        lastStreamFallbackReason: readStoredFallbackReason(store),
    }
}

export function recordTelegramPollStarted(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_STARTED_MS_KEY, String(recordedAtMs), recordedAtMs)
}

export function recordTelegramPollCompleted(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_COMPLETED_MS_KEY, String(recordedAtMs), recordedAtMs)
}

export function recordTelegramPollSuccess(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_SUCCESS_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_TIMEOUT_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_TIMEOUT_MESSAGE_KEY, "", recordedAtMs)
}

export function recordTelegramPollFailure(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY, message, recordedAtMs)
}

export function recordTelegramPollTimeout(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_TIMEOUT_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_TIMEOUT_MESSAGE_KEY, message, recordedAtMs)
    recordTelegramPollFailure(store, message, recordedAtMs)
}

export function recordTelegramSendSuccess(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_SEND_SUCCESS_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY, "", recordedAtMs)
}

export function recordTelegramSendFailure(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY, message, recordedAtMs)
}

export function recordTelegramProbeSuccess(store: SqliteStore, bot: TelegramBotProfile, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_PROBE_SUCCESS_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_BOT_ID_KEY, String(bot.id), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_BOT_USERNAME_KEY, bot.username ?? "", recordedAtMs)
}

export function recordTelegramProbeFailure(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY, message, recordedAtMs)
}

export function recordTelegramStreamSuccess(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_STREAM_SUCCESS_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_STREAM_ERROR_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_STREAM_ERROR_MESSAGE_KEY, "", recordedAtMs)
}

export function recordTelegramStreamFailure(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_STREAM_ERROR_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_STREAM_ERROR_MESSAGE_KEY, message, recordedAtMs)
}

export function recordTelegramPreviewEmit(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_PREVIEW_EMIT_MS_KEY, String(recordedAtMs), recordedAtMs)
}

export function recordTelegramStreamFallback(
    store: SqliteStore,
    reason: TelegramStreamingFallbackReason,
    recordedAtMs: number,
): void {
    store.putStateValue(TELEGRAM_LAST_STREAM_FALLBACK_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_STREAM_FALLBACK_REASON_KEY, reason, recordedAtMs)
}

export function readTelegramChatType(store: SqliteStore, chatId: string): TelegramChatType | null {
    const value = readStoredText(store, telegramChatTypeKey(chatId))
    return value === null ? null : value
}

export function recordTelegramChatType(
    store: SqliteStore,
    chatId: string,
    chatType: TelegramChatType,
    recordedAtMs: number,
): void {
    store.putStateValue(telegramChatTypeKey(chatId), chatType, recordedAtMs)
}

function telegramChatTypeKey(chatId: string): string {
    return `telegram.chat_type:${chatId}`
}

function readStoredInteger(store: SqliteStore, key: string): number | null {
    const value = store.getStateValue(key)
    if (value === null || value.length === 0) {
        return null
    }

    const parsed = Number.parseInt(value, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`stored ${key} is invalid: ${value}`)
    }

    return parsed
}

function readStoredText(store: SqliteStore, key: string): string | null {
    const value = store.getStateValue(key)
    if (value === null || value.length === 0) {
        return null
    }

    return value
}

function readStoredFallbackReason(store: SqliteStore): TelegramStreamingFallbackReason | null {
    const value = readStoredText(store, TELEGRAM_LAST_STREAM_FALLBACK_REASON_KEY)
    if (value === null) {
        return null
    }

    switch (value) {
        case "non_private_chat":
        case "stream_send_failed":
        case "stream_edit_failed":
        case "preview_not_established":
            return value
        default:
            throw new Error(`stored ${TELEGRAM_LAST_STREAM_FALLBACK_REASON_KEY} is invalid: ${value}`)
    }
}
