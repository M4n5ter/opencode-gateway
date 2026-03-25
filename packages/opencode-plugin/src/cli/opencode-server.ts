import { readFile } from "node:fs/promises"

import { resolveGatewayConfigPath, resolveGatewayWorkspacePath } from "../config/paths"
import { parseOpencodeConfig } from "./opencode-config"
import { resolveOpencodeConfigFile } from "./opencode-config-file"
import { resolveCliConfigDir } from "./paths"

const DEFAULT_SERVER_ORIGIN = "http://127.0.0.1:4096"
const WARM_REQUEST_TIMEOUT_MS = 2_000

type CliOptions = {
    managed: boolean
    configDir: string | null
}

export type ResolvedServeTarget = {
    configDir: string
    gatewayConfigPath: string
    workspaceDirPath: string
    opencodeConfigPath: string
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
    const opencodeConfig = await resolveOpencodeConfigFile(configDir)
    const serverOrigin = opencodeConfig.exists ? await resolveServerOrigin(opencodeConfig.path) : DEFAULT_SERVER_ORIGIN

    return {
        configDir,
        gatewayConfigPath,
        workspaceDirPath,
        opencodeConfigPath: opencodeConfig.path,
        serverOrigin,
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
    },
): Promise<void> {
    const deadlineMs = options?.deadlineMs ?? 30_000
    const intervalMs = options?.intervalMs ?? 250
    const warmUrl = new URL("/experimental/tool/ids", target.serverOrigin)
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

    throw new Error(`failed to warm the gateway plugin at ${target.serverOrigin} for ${target.workspaceDirPath}`)
}

export function resolveServerOriginFromDocument(document: Record<string, unknown>): string {
    const server = document.server
    if (server === null || typeof server !== "object" || Array.isArray(server)) {
        return DEFAULT_SERVER_ORIGIN
    }

    const hostname = readNonEmptyString((server as Record<string, unknown>).hostname)
    const port = readPort((server as Record<string, unknown>).port)
    if (hostname === null || port === null) {
        return DEFAULT_SERVER_ORIGIN
    }

    return `http://${hostname}:${port}`
}

async function resolveServerOrigin(configPath: string): Promise<string> {
    const source = await readFile(configPath, "utf8")
    const document = parseOpencodeConfig(source, configPath)
    return resolveServerOriginFromDocument(document)
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

function isGatewayToolList(value: unknown): value is string[] {
    return Array.isArray(value) && value.includes("gateway_status")
}

function delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}
