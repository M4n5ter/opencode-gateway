type EnvSource = Record<string, string | undefined>

type RawTelegramConfig = {
    enabled?: unknown
    bot_token?: unknown
    bot_token_env?: unknown
    poll_timeout_seconds?: unknown
    allowed_chats?: unknown
    allowed_users?: unknown
}

export type TelegramConfig =
    | {
          enabled: false
      }
    | {
          enabled: true
          botToken: string
          botTokenEnv: string | null
          pollTimeoutSeconds: number
          allowedChats: string[]
          allowedUsers: string[]
      }

export function parseTelegramConfig(value: unknown, env: EnvSource): TelegramConfig {
    const table = readTelegramTable(value)
    const enabled = readBoolean(table.enabled, "channels.telegram.enabled", false)

    if (!enabled) {
        return { enabled: false }
    }

    const configuredBotToken = readOptionalString(table.bot_token, "channels.telegram.bot_token")
    if (configuredBotToken !== null && table.bot_token_env !== undefined) {
        throw new Error("channels.telegram.bot_token and channels.telegram.bot_token_env are mutually exclusive")
    }

    const botTokenEnv =
        configuredBotToken === null
            ? readString(table.bot_token_env, "channels.telegram.bot_token_env", "TELEGRAM_BOT_TOKEN")
            : null
    const pollTimeoutSeconds = readPollTimeoutSeconds(table.poll_timeout_seconds)
    const allowedChats = readIdentifierList(table.allowed_chats, "channels.telegram.allowed_chats")
    const allowedUsers = readIdentifierList(table.allowed_users, "channels.telegram.allowed_users")
    const botToken = configuredBotToken ?? (botTokenEnv === null ? null : env[botTokenEnv]?.trim() ?? null)

    if (!botToken) {
        throw new Error(`Telegram is enabled but ${botTokenEnv} is not set`)
    }

    if (allowedChats.length === 0 && allowedUsers.length === 0) {
        throw new Error("Telegram is enabled but no allowlist entries were configured")
    }

    return {
        enabled: true,
        botToken,
        botTokenEnv,
        pollTimeoutSeconds,
        allowedChats,
        allowedUsers,
    }
}

function readTelegramTable(value: unknown): RawTelegramConfig {
    if (value === undefined) {
        return {}
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("channels.telegram must be a table when present")
    }

    return value as RawTelegramConfig
}

function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "boolean") {
        throw new Error(`${field} must be a boolean when present`)
    }

    return value
}

function readString(value: unknown, field: string, fallback: string): string {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "string") {
        throw new Error(`${field} must be a string when present`)
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function readOptionalString(value: unknown, field: string): string | null {
    if (value === undefined) {
        return null
    }

    return readString(value, field, "")
}

function readPollTimeoutSeconds(value: unknown): number {
    if (value === undefined) {
        return 25
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error("channels.telegram.poll_timeout_seconds must be an integer when present")
    }

    if (value < 1 || value > 50) {
        throw new Error("channels.telegram.poll_timeout_seconds must be between 1 and 50")
    }

    return value
}

function readIdentifierList(value: unknown, field: string): string[] {
    if (value === undefined) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new Error(`${field} must be an array when present`)
    }

    return value.map((entry) => normalizeIdentifier(entry, field))
}

function normalizeIdentifier(value: unknown, field: string): string {
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.length === 0) {
            throw new Error(`${field} entries must not be empty`)
        }

        return trimmed
    }

    if (typeof value === "number" && Number.isSafeInteger(value)) {
        return String(value)
    }

    throw new Error(`${field} entries must be strings or safe integers`)
}
