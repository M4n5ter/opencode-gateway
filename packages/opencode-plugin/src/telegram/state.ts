import type { SqliteStore } from "../store/sqlite"
import type { TelegramBotProfile } from "./types"

const TELEGRAM_UPDATE_OFFSET_KEY = "telegram.update_offset"
const TELEGRAM_LAST_POLL_SUCCESS_MS_KEY = "telegram.last_poll_success_ms"
const TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY = "telegram.last_poll_error_at_ms"
const TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY = "telegram.last_poll_error_message"
const TELEGRAM_LAST_SEND_SUCCESS_MS_KEY = "telegram.last_send_success_ms"
const TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY = "telegram.last_send_error_at_ms"
const TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY = "telegram.last_send_error_message"
const TELEGRAM_LAST_PROBE_SUCCESS_MS_KEY = "telegram.last_probe_success_ms"
const TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY = "telegram.last_probe_error_at_ms"
const TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY = "telegram.last_probe_error_message"
const TELEGRAM_LAST_BOT_ID_KEY = "telegram.last_bot_id"
const TELEGRAM_LAST_BOT_USERNAME_KEY = "telegram.last_bot_username"

export type TelegramHealthSnapshot = {
    updateOffset: number | null
    lastPollSuccessMs: number | null
    lastPollErrorAtMs: number | null
    lastPollErrorMessage: string | null
    lastSendSuccessMs: number | null
    lastSendErrorAtMs: number | null
    lastSendErrorMessage: string | null
    lastProbeSuccessMs: number | null
    lastProbeErrorAtMs: number | null
    lastProbeErrorMessage: string | null
    lastBotId: string | null
    lastBotUsername: string | null
}

export function readTelegramHealthSnapshot(store: SqliteStore): TelegramHealthSnapshot {
    return {
        updateOffset: readStoredInteger(store, TELEGRAM_UPDATE_OFFSET_KEY),
        lastPollSuccessMs: readStoredInteger(store, TELEGRAM_LAST_POLL_SUCCESS_MS_KEY),
        lastPollErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY),
        lastPollErrorMessage: readStoredText(store, TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY),
        lastSendSuccessMs: readStoredInteger(store, TELEGRAM_LAST_SEND_SUCCESS_MS_KEY),
        lastSendErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_SEND_ERROR_AT_MS_KEY),
        lastSendErrorMessage: readStoredText(store, TELEGRAM_LAST_SEND_ERROR_MESSAGE_KEY),
        lastProbeSuccessMs: readStoredInteger(store, TELEGRAM_LAST_PROBE_SUCCESS_MS_KEY),
        lastProbeErrorAtMs: readStoredInteger(store, TELEGRAM_LAST_PROBE_ERROR_AT_MS_KEY),
        lastProbeErrorMessage: readStoredText(store, TELEGRAM_LAST_PROBE_ERROR_MESSAGE_KEY),
        lastBotId: readStoredText(store, TELEGRAM_LAST_BOT_ID_KEY),
        lastBotUsername: readStoredText(store, TELEGRAM_LAST_BOT_USERNAME_KEY),
    }
}

export function recordTelegramPollSuccess(store: SqliteStore, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_SUCCESS_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY, "", recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY, "", recordedAtMs)
}

export function recordTelegramPollFailure(store: SqliteStore, message: string, recordedAtMs: number): void {
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_AT_MS_KEY, String(recordedAtMs), recordedAtMs)
    store.putStateValue(TELEGRAM_LAST_POLL_ERROR_MESSAGE_KEY, message, recordedAtMs)
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
