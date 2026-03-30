import { readFile } from "node:fs/promises"
import { parse as parseToml } from "smol-toml"

import { inspectGatewayPlugin, parseOpencodeConfig } from "./opencode-config"
import { resolveOpencodeConfigFile } from "./opencode-config-file"
import { resolveServeTarget } from "./opencode-server"
import { pathExists, resolveCliConfigDir } from "./paths"

type DoctorOptions = {
    managed: boolean
    configDir: string | null
    serverHost: string | null
    serverPort: number | null
}

export async function runDoctor(options: DoctorOptions, env: Record<string, string | undefined>): Promise<void> {
    const configDir = resolveCliConfigDir(options, env)
    const opencodeConfig = await resolveOpencodeConfigFile(configDir)
    const opencodeStatus = await inspectOpencodeConfig(opencodeConfig.path)
    const gatewayOverride = env.OPENCODE_GATEWAY_CONFIG?.trim() || null
    const serveTarget = await resolveServeTarget(options, env)

    console.log("doctor report")
    console.log(`  config dir: ${configDir}`)
    console.log(`  opencode config: ${await describePath(opencodeConfig.path)}`)
    console.log(`  gateway config: ${await describePath(serveTarget.gatewayConfigPath)}`)
    console.log(`  gateway workspace: ${await describePath(serveTarget.workspaceDirPath)}`)
    console.log(`  warm server: ${serveTarget.serverOrigin}`)
    console.log(`  warm host: ${serveTarget.serverEndpoint.connectHost}`)
    console.log(`  warm port: ${serveTarget.serverEndpoint.port}`)
    console.log(`  warm directory: ${serveTarget.workspaceDirPath}`)
    console.log(`  gateway config override: ${gatewayOverride ?? "not set"}`)
    console.log(`  plugin configured: ${opencodeStatus.pluginConfigured}`)
    console.log(`  telegram token: ${await inspectTelegramToken(serveTarget.gatewayConfigPath, env)}`)

    if (opencodeStatus.error !== null) {
        console.log(`  opencode config error: ${opencodeStatus.error}`)
    }
}

async function inspectTelegramToken(
    gatewayConfigPath: string,
    env: Record<string, string | undefined>,
): Promise<string> {
    if (!(await pathExists(gatewayConfigPath))) {
        return "unknown (gateway config missing)"
    }

    try {
        const parsed = parseToml(await readFile(gatewayConfigPath, "utf8")) as Record<string, unknown>
        const channels = asTable(parsed.channels)
        const telegram = asTable(channels?.telegram)

        if (telegram?.enabled !== true) {
            return "not configured"
        }

        const directToken = typeof telegram.bot_token === "string" ? telegram.bot_token.trim() : ""
        if (directToken.length > 0) {
            return "configured directly via channels.telegram.bot_token"
        }

        const tokenEnv =
            typeof telegram.bot_token_env === "string" && telegram.bot_token_env.trim().length > 0
                ? telegram.bot_token_env.trim()
                : "TELEGRAM_BOT_TOKEN"
        return `${tokenEnv}: ${env[tokenEnv]?.trim() ? "set" : "missing"}`
    } catch (error) {
        return `unknown (${error instanceof Error ? error.message : String(error)})`
    }
}

function asTable(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null
    }

    return value as Record<string, unknown>
}

async function describePath(path: string): Promise<string> {
    return (await pathExists(path)) ? `present at ${path}` : `missing at ${path}`
}

async function inspectOpencodeConfig(path: string): Promise<{ pluginConfigured: string; error: string | null }> {
    if (!(await pathExists(path))) {
        return {
            pluginConfigured: "no",
            error: null,
        }
    }

    try {
        const parsed = parseOpencodeConfig(await readFile(path, "utf8"), path)

        return {
            pluginConfigured: inspectGatewayPlugin(parsed),
            error: null,
        }
    } catch (error) {
        return {
            pluginConfigured: "unknown",
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
