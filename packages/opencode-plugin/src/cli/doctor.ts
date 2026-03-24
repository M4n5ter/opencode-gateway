import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { GATEWAY_CONFIG_FILE, OPENCODE_CONFIG_FILE, resolveGatewayWorkspacePath } from "../config/paths"
import { parseOpencodeConfig } from "./opencode-config"
import { pathExists, resolveCliConfigDir } from "./paths"

type DoctorOptions = {
    managed: boolean
    configDir: string | null
}

export async function runDoctor(options: DoctorOptions, env: Record<string, string | undefined>): Promise<void> {
    const configDir = resolveCliConfigDir(options, env)
    const opencodeConfigPath = join(configDir, OPENCODE_CONFIG_FILE)
    const gatewayConfigPath = join(configDir, GATEWAY_CONFIG_FILE)
    const workspaceDirPath = resolveGatewayWorkspacePath(gatewayConfigPath)
    const opencodeStatus = await inspectOpencodeConfig(opencodeConfigPath)
    const gatewayOverride = env.OPENCODE_GATEWAY_CONFIG?.trim() || null

    console.log("doctor report")
    console.log(`  config dir: ${configDir}`)
    console.log(`  opencode config: ${await describePath(opencodeConfigPath)}`)
    console.log(`  gateway config: ${await describePath(gatewayConfigPath)}`)
    console.log(`  gateway workspace: ${await describePath(workspaceDirPath)}`)
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
        const plugins = parsed.plugin

        if (plugins === undefined) {
            return {
                pluginConfigured: "no",
                error: null,
            }
        }

        if (!Array.isArray(plugins)) {
            return {
                pluginConfigured: "invalid",
                error: "`plugin` is not an array",
            }
        }

        return {
            pluginConfigured: plugins.some((entry) => entry === "opencode-gateway") ? "yes" : "no",
            error: null,
        }
    } catch (error) {
        return {
            pluginConfigured: "unknown",
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
