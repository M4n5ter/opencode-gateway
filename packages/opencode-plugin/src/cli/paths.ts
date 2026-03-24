import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { resolve } from "node:path"

import { resolveManagedOpencodeConfigDir, resolveOpencodeConfigDir } from "../config/paths"

type CliPathOptions = {
    managed: boolean
    configDir: string | null
}

export function resolveCliConfigDir(options: CliPathOptions, env: Record<string, string | undefined>): string {
    if (options.configDir !== null) {
        return resolve(options.configDir)
    }

    if (options.managed) {
        return resolveManagedOpencodeConfigDir(env)
    }

    return resolveOpencodeConfigDir(env)
}

export async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK)
        return true
    } catch {
        return false
    }
}
