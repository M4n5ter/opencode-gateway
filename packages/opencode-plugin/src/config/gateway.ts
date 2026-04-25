import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { parse as parseToml } from "smol-toml"

import { type GatewayLogLevel, parseGatewayLogLevel } from "../host/logger"
import { type CronConfig, parseCronConfig } from "./cron"
import { type GatewayMemoryConfig, parseMemoryConfig } from "./memory"
import { defaultGatewayStateDbPath, resolveGatewayConfigPath, resolveGatewayWorkspacePath } from "./paths"
import { parseTelegramConfig, type TelegramConfig } from "./telegram"

type RawGatewayConfig = {
    cron?: unknown
    gateway?: {
        state_db?: unknown
        log_level?: unknown
        http_proxy?: unknown
        mailbox?: unknown
        inflight_messages?: unknown
        execution?: unknown
        timezone?: unknown
    }
    memory?: unknown
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

type RawExecutionConfig = {
    session_wait_timeout_ms?: unknown
    prompt_progress_timeout_ms?: unknown
    hard_timeout_ms?: unknown
    abort_settle_timeout_ms?: unknown
}

type RawInflightMessagesConfig = {
    default_policy?: unknown
}

type RawHttpProxyConfig = {
    enabled?: unknown
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

export type GatewayExecutionConfig = {
    sessionWaitTimeoutMs: number
    promptProgressTimeoutMs: number
    hardTimeoutMs: number | null
    abortSettleTimeoutMs: number
}

export type GatewayInflightMessagesPolicy = "ask" | "queue" | "interrupt"

export type GatewayInflightMessagesConfig = {
    defaultPolicy: GatewayInflightMessagesPolicy
}

export type GatewayHttpProxyConfig = {
    enabled: boolean
}

export type GatewayConfig = {
    configPath: string
    stateDbPath: string
    mediaRootPath: string
    workspaceDirPath: string
    logLevel: GatewayLogLevel
    hasLegacyGatewayTimezone: boolean
    legacyGatewayTimezone: string | null
    httpProxy: GatewayHttpProxyConfig
    mailbox: GatewayMailboxConfig
    inflightMessages: GatewayInflightMessagesConfig
    execution: GatewayExecutionConfig
    memory: GatewayMemoryConfig
    cron: CronConfig
    telegram: TelegramConfig
}

type EnvSource = Record<string, string | undefined>

export async function loadGatewayConfig(env: EnvSource = process.env): Promise<GatewayConfig> {
    const configPath = resolveGatewayConfigPath(env)
    const workspaceDirPath = resolveGatewayWorkspacePath(configPath)
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
        workspaceDirPath,
        logLevel: parseGatewayLogLevel(rawConfig?.gateway?.log_level, "gateway.log_level"),
        hasLegacyGatewayTimezone: rawConfig?.gateway?.timezone !== undefined,
        legacyGatewayTimezone: readLegacyGatewayTimezone(rawConfig?.gateway?.timezone),
        httpProxy: parseHttpProxyConfig(rawConfig?.gateway?.http_proxy),
        mailbox: parseMailboxConfig(rawConfig?.gateway?.mailbox),
        inflightMessages: parseInflightMessagesConfig(rawConfig?.gateway?.inflight_messages),
        execution: parseExecutionConfig(rawConfig?.gateway?.execution),
        memory: await parseMemoryConfig(rawConfig?.memory, workspaceDirPath),
        cron: parseCronConfig(rawConfig?.cron),
        telegram: parseTelegramConfig(rawConfig?.channels?.telegram, env),
    }
}

function parseHttpProxyConfig(value: unknown): GatewayHttpProxyConfig {
    const table = readHttpProxyTable(value)

    return {
        enabled: readBoolean(table.enabled, "gateway.http_proxy.enabled", true),
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

function parseExecutionConfig(value: unknown): GatewayExecutionConfig {
    const table = readExecutionTable(value)

    return {
        sessionWaitTimeoutMs: readPositiveInteger(
            table.session_wait_timeout_ms,
            "gateway.execution.session_wait_timeout_ms",
            30 * 60_000,
        ),
        promptProgressTimeoutMs: readPositiveInteger(
            table.prompt_progress_timeout_ms,
            "gateway.execution.prompt_progress_timeout_ms",
            30 * 60_000,
        ),
        hardTimeoutMs: readOptionalHardTimeoutMs(table.hard_timeout_ms),
        abortSettleTimeoutMs: readPositiveInteger(
            table.abort_settle_timeout_ms,
            "gateway.execution.abort_settle_timeout_ms",
            5_000,
        ),
    }
}

function parseInflightMessagesConfig(value: unknown): GatewayInflightMessagesConfig {
    const table = readInflightMessagesTable(value)

    return {
        defaultPolicy: readInflightMessagesPolicy(table.default_policy),
    }
}

async function readGatewayConfigFile(path: string): Promise<RawGatewayConfig | null> {
    if (!existsSync(path)) {
        return null
    }

    const source = await readFile(path, "utf8")
    const parsed = parseToml(source)

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

function readHttpProxyTable(value: unknown): RawHttpProxyConfig {
    return readOptionalTable(value, "gateway.http_proxy")
}

function readMailboxTable(value: unknown): RawMailboxConfig {
    return readOptionalTable(value, "gateway.mailbox")
}

function readExecutionTable(value: unknown): RawExecutionConfig {
    return readOptionalTable(value, "gateway.execution")
}

function readInflightMessagesTable(value: unknown): RawInflightMessagesConfig {
    return readOptionalTable(value, "gateway.inflight_messages")
}

function readOptionalTable<T>(value: unknown, field: string): T {
    if (value === undefined) {
        return {} as T
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} must be a table when present`)
    }

    return value as T
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

function readPositiveInteger(value: unknown, field: string, fallback: number): number {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`${field} must be an integer when present`)
    }

    if (value <= 0) {
        throw new Error(`${field} must be greater than 0`)
    }

    return value
}

function readOptionalHardTimeoutMs(value: unknown): number | null {
    if (value === undefined) {
        return null
    }

    if (value === null) {
        return null
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error("gateway.execution.hard_timeout_ms must be an integer when present")
    }

    if (value < 60_000) {
        throw new Error("gateway.execution.hard_timeout_ms must be at least 60000")
    }

    return value
}

function readInflightMessagesPolicy(value: unknown): GatewayInflightMessagesPolicy {
    if (value === undefined) {
        return "ask"
    }

    if (value === "ask" || value === "queue" || value === "interrupt") {
        return value
    }

    throw new Error('gateway.inflight_messages.default_policy must be "ask", "queue", or "interrupt"')
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

function defaultStateDbPath(env: EnvSource): string {
    return defaultGatewayStateDbPath(env)
}

function resolveMediaRootPath(stateDbPath: string): string {
    return join(dirname(stateDbPath), "media")
}
