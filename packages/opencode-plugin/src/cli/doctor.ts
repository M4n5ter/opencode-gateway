import { readFile } from "node:fs/promises"

import { inspectGatewayPlugin, parseOpencodeConfig } from "./opencode-config"
import { resolveOpencodeConfigFile } from "./opencode-config-file"
import { resolveServeTarget } from "./opencode-server"
import { pathExists, resolveCliConfigDir } from "./paths"

type DoctorOptions = {
    managed: boolean
    configDir: string | null
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
    console.log(`  warm directory: ${serveTarget.workspaceDirPath}`)
    console.log(`  gateway config override: ${gatewayOverride ?? "not set"}`)
    console.log(`  plugin configured: ${opencodeStatus.pluginConfigured}`)
    console.log(`  TELEGRAM_BOT_TOKEN: ${env.TELEGRAM_BOT_TOKEN?.trim() ? "set" : "missing"}`)

    if (opencodeStatus.error !== null) {
        console.log(`  opencode config error: ${opencodeStatus.error}`)
    }
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
