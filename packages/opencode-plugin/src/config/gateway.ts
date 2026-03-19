import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

type EnvSource = Record<string, string | undefined>

type RawGatewayConfig = {
    gateway?: {
        state_db?: unknown
    }
}

export type GatewayConfig = {
    configPath: string
    stateDbPath: string
}

export async function loadGatewayConfig(env: EnvSource = process.env): Promise<GatewayConfig> {
    const configPath = resolveGatewayConfigPath(env)
    const rawConfig = await readGatewayConfigFile(configPath)
    const stateDbValue = rawConfig?.gateway?.state_db

    if (stateDbValue !== undefined && typeof stateDbValue !== "string") {
        throw new Error("gateway.state_db must be a string when present")
    }

    return {
        configPath,
        stateDbPath: resolveStateDbPath(stateDbValue, configPath, env),
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

function defaultGatewayConfigPath(env: EnvSource): string {
    return join(resolveConfigHome(env), "opencode-gateway", "config.toml")
}

function defaultStateDbPath(env: EnvSource): string {
    return join(resolveDataHome(env), "opencode-gateway", "state.db")
}

function resolveConfigHome(env: EnvSource): string {
    return env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

function resolveDataHome(env: EnvSource): string {
    return env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
}
