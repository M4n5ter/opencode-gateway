import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { type CronConfig, parseCronConfig } from "./cron"
import { parseTelegramConfig, type TelegramConfig } from "./telegram"

type RawGatewayConfig = {
    cron?: unknown
    gateway?: {
        state_db?: unknown
        mailbox?: unknown
        timezone?: unknown
    }
    channels?: {
        telegram?: unknown
    }
}

type RawMailboxConfig = {
    batch_replies?: unknown
    batch_window_ms?: unknown
    routes?: unknown
}

type RawMailboxRouteConfig = {
    channel?: unknown
    target?: unknown
    topic?: unknown
    mailbox_key?: unknown
}

export type GatewayMailboxRouteConfig = {
    channel: string
    target: string
    topic: string | null
    mailboxKey: string
}

export type GatewayMailboxConfig = {
    batchReplies: boolean
    batchWindowMs: number
    routes: GatewayMailboxRouteConfig[]
}

export type GatewayConfig = {
    configPath: string
    stateDbPath: string
    mediaRootPath: string
    hasLegacyGatewayTimezone: boolean
    legacyGatewayTimezone: string | null
    mailbox: GatewayMailboxConfig
    cron: CronConfig
    telegram: TelegramConfig
}

type EnvSource = Record<string, string | undefined>

export async function loadGatewayConfig(env: EnvSource = process.env): Promise<GatewayConfig> {
    const configPath = resolveGatewayConfigPath(env)
    const rawConfig = await readGatewayConfigFile(configPath)
    const stateDbValue = rawConfig?.gateway?.state_db

    if (stateDbValue !== undefined && typeof stateDbValue !== "string") {
        throw new Error("gateway.state_db must be a string when present")
    }

    const stateDbPath = resolveStateDbPath(stateDbValue, configPath, env)

    return {
        configPath,
        stateDbPath,
        mediaRootPath: resolveMediaRootPath(stateDbPath),
        hasLegacyGatewayTimezone: rawConfig?.gateway?.timezone !== undefined,
        legacyGatewayTimezone: readLegacyGatewayTimezone(rawConfig?.gateway?.timezone),
        mailbox: parseMailboxConfig(rawConfig?.gateway?.mailbox),
        cron: parseCronConfig(rawConfig?.cron),
        telegram: parseTelegramConfig(rawConfig?.channels?.telegram, env),
    }
}

function parseMailboxConfig(value: unknown): GatewayMailboxConfig {
    const table = readMailboxTable(value)

    return {
        batchReplies: readBoolean(table.batch_replies, "gateway.mailbox.batch_replies", false),
        batchWindowMs: readBatchWindowMs(table.batch_window_ms),
        routes: readMailboxRoutes(table.routes),
    }
}

function resolveGatewayConfigPath(env: EnvSource): string {
    const explicit = env.OPENCODE_GATEWAY_CONFIG
    if (explicit && explicit.trim().length > 0) {
        return resolve(explicit)
    }

    const opencodeConfigDir = env.OPENCODE_CONFIG_DIR
    if (opencodeConfigDir && opencodeConfigDir.trim().length > 0) {
        return resolve(opencodeConfigDir, "..", "config.toml")
    }

    return defaultGatewayConfigPath(env)
}

async function readGatewayConfigFile(path: string): Promise<RawGatewayConfig | null> {
    if (!existsSync(path)) {
        return null
    }

    const source = await Bun.file(path).text()
    const parsed = Bun.TOML.parse(source)

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`gateway config must decode to a table: ${path}`)
    }

    return parsed as RawGatewayConfig
}

function resolveStateDbPath(stateDb: string | undefined, configPath: string, env: EnvSource): string {
    if (!stateDb || stateDb.trim().length === 0) {
        return defaultStateDbPath(env)
    }

    if (isAbsolute(stateDb)) {
        return stateDb
    }

    return resolve(dirname(configPath), stateDb)
}

function readMailboxTable(value: unknown): RawMailboxConfig {
    if (value === undefined) {
        return {}
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("gateway.mailbox must be a table when present")
    }

    return value as RawMailboxConfig
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

function readBatchWindowMs(value: unknown): number {
    if (value === undefined) {
        return 1_500
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error("gateway.mailbox.batch_window_ms must be an integer when present")
    }

    if (value < 0 || value > 60_000) {
        throw new Error("gateway.mailbox.batch_window_ms must be between 0 and 60000")
    }

    return value
}

function readMailboxRoutes(value: unknown): GatewayMailboxRouteConfig[] {
    if (value === undefined) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new Error("gateway.mailbox.routes must be an array when present")
    }

    const routes = value.map((entry, index) => readMailboxRoute(entry, index))
    const seen = new Set<string>()

    for (const route of routes) {
        const key = `${route.channel}:${route.target}:${route.topic ?? ""}`
        if (seen.has(key)) {
            throw new Error(`gateway.mailbox.routes contains a duplicate match for ${key}`)
        }

        seen.add(key)
    }

    return routes
}

function readMailboxRoute(value: unknown, index: number): GatewayMailboxRouteConfig {
    const field = `gateway.mailbox.routes[${index}]`
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} must be a table`)
    }

    const route = value as RawMailboxRouteConfig

    return {
        channel: readRequiredString(route.channel, `${field}.channel`),
        target: readRequiredString(route.target, `${field}.target`),
        topic: readOptionalString(route.topic, `${field}.topic`),
        mailboxKey: readRequiredString(route.mailbox_key, `${field}.mailbox_key`),
    }
}

function readRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`)
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

    return readRequiredString(value, field)
}

function readLegacyGatewayTimezone(value: unknown): string | null {
    if (typeof value !== "string") {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function defaultGatewayConfigPath(env: EnvSource): string {
    return join(resolveConfigHome(env), "opencode-gateway", "config.toml")
}

function defaultStateDbPath(env: EnvSource): string {
    return join(resolveDataHome(env), "opencode-gateway", "state.db")
}

function resolveMediaRootPath(stateDbPath: string): string {
    return join(dirname(stateDbPath), "media")
}

function resolveConfigHome(env: EnvSource): string {
    return env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

function resolveDataHome(env: EnvSource): string {
    return env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
}
