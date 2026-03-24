import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { defaultGatewayStateDbPath, GATEWAY_CONFIG_FILE, resolveGatewayWorkspacePath } from "../config/paths"
import {
    createDefaultOpencodeConfig,
    ensureGatewayPlugin,
    parseOpencodeConfig,
    stringifyOpencodeConfig,
} from "./opencode-config"
import { resolveOpencodeConfigFile } from "./opencode-config-file"
import { pathExists, resolveCliConfigDir } from "./paths"
import { buildGatewayConfigTemplate } from "./templates"

type InitOptions = {
    managed: boolean
    configDir: string | null
}

export async function runInit(options: InitOptions, env: Record<string, string | undefined>): Promise<void> {
    const configDir = resolveCliConfigDir(options, env)
    const gatewayConfigPath = join(configDir, GATEWAY_CONFIG_FILE)
    const workspaceDirPath = resolveGatewayWorkspacePath(gatewayConfigPath)
    const opencodeConfig = await resolveOpencodeConfigFile(configDir)
    const opencodeConfigPath = opencodeConfig.path

    await mkdir(configDir, { recursive: true })
    await mkdir(workspaceDirPath, { recursive: true })

    let opencodeStatus = "already present"
    if (!opencodeConfig.exists) {
        await writeFile(opencodeConfigPath, stringifyOpencodeConfig(createDefaultOpencodeConfig(options.managed)))
        opencodeStatus = "created"
    } else {
        const source = await readFile(opencodeConfigPath, "utf8")
        const parsed = parseOpencodeConfig(source, opencodeConfigPath)
        const next = ensureGatewayPlugin(parsed)

        if (next.changed) {
            await writeFile(opencodeConfigPath, stringifyOpencodeConfig(next.document))
            opencodeStatus = "updated"
        }
    }

    let gatewayStatus = "already present"
    if (!(await pathExists(gatewayConfigPath))) {
        await mkdir(dirname(gatewayConfigPath), { recursive: true })
        await writeFile(gatewayConfigPath, buildGatewayConfigTemplate(defaultGatewayStateDbPath(env)))
        gatewayStatus = "created"
    }

    console.log(`config dir: ${configDir}`)
    console.log(`opencode config: ${opencodeConfigPath} (${opencodeStatus})`)
    console.log(`gateway config: ${gatewayConfigPath} (${gatewayStatus})`)
    console.log(`gateway workspace: ${workspaceDirPath} (ready)`)
}
