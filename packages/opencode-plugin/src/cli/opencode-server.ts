import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

import { resolveGatewayConfigPath, resolveGatewayControlDir, resolveGatewayWorkspacePath } from "../config/paths"
import { parseOpencodeConfig } from "./opencode-config"
import { resolveOpencodeConfigFile } from "./opencode-config-file"
import { resolveCliConfigDir } from "./paths"

const DEFAULT_SERVER_HOST = "127.0.0.1"
const DEFAULT_SERVER_PORT = 4096
const WARM_REQUEST_TIMEOUT_MS = 2_000
const LISTEN_DISCOVERY_TIMEOUT_MS = 30_000

const execFileAsync = promisify(execFile)

type CliOptions = {
    managed: boolean
    configDir: string | null
    serverHost?: string | null
    serverPort?: number | null
}

export type ResolvedServerEndpoint = {
    host: string
    connectHost: string
    port: number
    origin: string
}

export type ResolvedServeTarget = {
    configDir: string
    gatewayConfigPath: string
    workspaceDirPath: string
    opencodeConfigPath: string
    controlDirPath: string
    serverEndpoint: ResolvedServerEndpoint
    serverOrigin: string
    env: Record<string, string>
}

export async function resolveServeTarget(
    options: CliOptions,
    env: Record<string, string | undefined>,
): Promise<ResolvedServeTarget> {
    const configDir = resolveCliConfigDir(options, env)
    const gatewayConfigPath = resolveGatewayConfigPath({
        ...env,
        OPENCODE_CONFIG_DIR: configDir,
    })
    const workspaceDirPath = resolveGatewayWorkspacePath(gatewayConfigPath)
    const controlDirPath = resolveGatewayControlDir({
        ...env,
        OPENCODE_CONFIG_DIR: configDir,
    })
    const opencodeConfig = await resolveOpencodeConfigFile(configDir)
    const serverEndpoint = opencodeConfig.exists
        ? await resolveServerEndpoint(opencodeConfig.path, options)
        : resolveServerEndpointFromDocument({}, options)

    return {
        configDir,
        gatewayConfigPath,
        workspaceDirPath,
        opencodeConfigPath: opencodeConfig.path,
        controlDirPath,
        serverEndpoint,
        serverOrigin: serverEndpoint.origin,
        env: {
            OPENCODE_CONFIG_DIR: configDir,
            OPENCODE_CONFIG: opencodeConfig.path,
        },
    }
}

export async function warmGatewayProject(
    target: ResolvedServeTarget,
    options?: {
        deadlineMs?: number
        intervalMs?: number
        endpoint?: ResolvedServerEndpoint
    },
): Promise<void> {
    const deadlineMs = options?.deadlineMs ?? 30_000
    const intervalMs = options?.intervalMs ?? 250
    const endpoint = options?.endpoint ?? target.serverEndpoint
    const warmUrl = new URL("/experimental/tool/ids", endpoint.origin)
    warmUrl.searchParams.set("directory", target.workspaceDirPath)
    const deadline = Date.now() + deadlineMs

    while (Date.now() < deadline) {
        try {
            const response = await fetch(warmUrl, {
                signal: AbortSignal.timeout(WARM_REQUEST_TIMEOUT_MS),
            })

            if (response.ok) {
                const payload = await response.json()
                if (isGatewayToolList(payload)) {
                    return
                }
            }
        } catch {
            // The server may still be starting. Retry until the deadline expires.
        }

        await delay(intervalMs)
    }

    throw new Error(`failed to warm the gateway plugin at ${endpoint.origin} for ${target.workspaceDirPath}`)
}

export async function resolveServerEndpointForPid(
    pid: number,
    options?: {
        deadlineMs?: number
        intervalMs?: number
    },
): Promise<ResolvedServerEndpoint> {
    const deadlineMs = options?.deadlineMs ?? LISTEN_DISCOVERY_TIMEOUT_MS
    const intervalMs = options?.intervalMs ?? 250
    const deadline = Date.now() + deadlineMs

    while (Date.now() < deadline) {
        const endpoint = await inspectListeningEndpointForPid(pid)
        if (endpoint !== null) {
            return endpoint
        }

        await delay(intervalMs)
    }

    throw new Error(`failed to discover a listening OpenCode port for pid ${pid} within ${deadlineMs}ms`)
}

export function resolveServerOriginFromDocument(document: Record<string, unknown>): string {
    return resolveServerEndpointFromDocument(document).origin
}

export function resolveServerEndpointFromDocument(
    document: Record<string, unknown>,
    options?: Pick<CliOptions, "serverHost" | "serverPort">,
): ResolvedServerEndpoint {
    const server = document.server
    const table =
        server !== null && typeof server === "object" && !Array.isArray(server)
            ? (server as Record<string, unknown>)
            : {}
    const host = options?.serverHost ?? readNonEmptyString(table.hostname) ?? DEFAULT_SERVER_HOST
    const port = options?.serverPort ?? readPort(table.port) ?? DEFAULT_SERVER_PORT
    const connectHost = normalizeConnectHost(host)

    return {
        host,
        connectHost,
        port,
        origin: `http://${formatOriginHost(connectHost)}:${port}`,
    }
}

async function resolveServerEndpoint(
    configPath: string,
    options?: Pick<CliOptions, "serverHost" | "serverPort">,
): Promise<ResolvedServerEndpoint> {
    const source = await readFile(configPath, "utf8")
    const document = parseOpencodeConfig(source, configPath)
    return resolveServerEndpointFromDocument(document, options)
}

function readNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
}

function readPort(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return null
    }

    return value >= 1 && value <= 65_535 ? value : null
}

function normalizeConnectHost(host: string): string {
    const normalized = host.trim()
    if (normalized === "0.0.0.0") {
        return "127.0.0.1"
    }

    if (normalized === "::" || normalized === "[::]") {
        return "::1"
    }

    return normalized
}

function formatOriginHost(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

function isGatewayToolList(value: unknown): value is string[] {
    return Array.isArray(value) && value.includes("gateway_status")
}

async function inspectListeningEndpointForPid(pid: number): Promise<ResolvedServerEndpoint | null> {
    try {
        const { stdout } = await execFileAsync("lsof", ["-Pan", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], {
            timeout: WARM_REQUEST_TIMEOUT_MS,
        })

        return parseLsofListenOutput(stdout)
    } catch (error) {
        if (isLsofPendingError(error)) {
            return null
        }

        throw new Error(`failed to inspect listening port for pid ${pid}: ${formatError(error)}`)
    }
}

export function parseLsofListenOutput(stdout: string): ResolvedServerEndpoint | null {
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith("n")) {
            continue
        }

        const endpoint = parseListeningAddress(line.slice(1))
        if (endpoint !== null) {
            return endpoint
        }
    }

    return null
}

function parseListeningAddress(value: string): ResolvedServerEndpoint | null {
    const normalized = value.trim()
    if (normalized.length === 0) {
        return null
    }

    const bracketed = normalized.match(/^\[([^\]]+)\]:(\d+)$/)
    if (bracketed) {
        return buildResolvedEndpoint(bracketed[1], Number.parseInt(bracketed[2], 10))
    }

    const lastColon = normalized.lastIndexOf(":")
    if (lastColon === -1) {
        return null
    }

    const host = normalized.slice(0, lastColon)
    const port = Number.parseInt(normalized.slice(lastColon + 1), 10)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return null
    }

    return buildResolvedEndpoint(host, port)
}

function buildResolvedEndpoint(host: string, port: number): ResolvedServerEndpoint {
    const normalizedHost = host.trim()
    const connectHost = normalizeConnectHost(normalizedHost === "*" ? DEFAULT_SERVER_HOST : normalizedHost)

    return {
        host: normalizedHost,
        connectHost,
        port,
        origin: `http://${formatOriginHost(connectHost)}:${port}`,
    }
}

function isLsofPendingError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ((typeof error.code === "number" && error.code === 1) ||
            (typeof error.code === "string" && error.code === "ENOENT"))
    )
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}
