import { join } from "node:path"

import { OPENCODE_CONFIG_FILE_CANDIDATES, OPENCODE_CONFIG_FILE_JSONC } from "../config/paths"
import { pathExists } from "./paths"

export type ResolvedOpencodeConfigFile = {
    path: string
    exists: boolean
}

export async function resolveOpencodeConfigFile(configDir: string): Promise<ResolvedOpencodeConfigFile> {
    for (const fileName of OPENCODE_CONFIG_FILE_CANDIDATES) {
        const path = join(configDir, fileName)
        if (await pathExists(path)) {
            return {
                path,
                exists: true,
            }
        }
    }

    return {
        path: join(configDir, OPENCODE_CONFIG_FILE_JSONC),
        exists: false,
    }
}
