import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const GATEWAY_CONFIG_FILE = "opencode-gateway.toml"
export const OPENCODE_CONFIG_FILE = "opencode.json"
export const GATEWAY_WORKSPACE_DIR = "opencode-gateway-workspace"

type EnvSource = Record<string, string | undefined>

export function resolveGatewayConfigPath(env: EnvSource): string {
    const explicit = env.OPENCODE_GATEWAY_CONFIG
    if (explicit && explicit.trim().length > 0) {
        return resolve(explicit)
    }

    return join(resolveOpencodeConfigDir(env), GATEWAY_CONFIG_FILE)
}

export function resolveOpencodeConfigDir(env: EnvSource): string {
    const explicit = env.OPENCODE_CONFIG_DIR
    if (explicit && explicit.trim().length > 0) {
        return resolve(explicit)
    }

    return defaultOpencodeConfigDir(env)
}

export function resolveManagedOpencodeConfigDir(env: EnvSource): string {
    return join(resolveConfigHome(env), "opencode-gateway", "opencode")
}

export function resolveGatewayWorkspacePath(configPath: string): string {
    return join(dirname(configPath), GATEWAY_WORKSPACE_DIR)
}

export function defaultGatewayStateDbPath(env: EnvSource): string {
    return join(resolveDataHome(env), "opencode-gateway", "state.db")
}

export function resolveConfigHome(env: EnvSource): string {
    return env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

export function resolveDataHome(env: EnvSource): string {
    return env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
}

function defaultOpencodeConfigDir(env: EnvSource): string {
    return join(resolveConfigHome(env), "opencode")
}
