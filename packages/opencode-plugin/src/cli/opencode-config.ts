const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json"
const PACKAGE_NAME = "opencode-gateway"

type OpencodeConfigDocument = Record<string, unknown>

export type EnsurePluginResult = {
    changed: boolean
    document: OpencodeConfigDocument
}

export function createDefaultOpencodeConfig(managed: boolean): OpencodeConfigDocument {
    const document: OpencodeConfigDocument = {
        $schema: OPENCODE_SCHEMA_URL,
        plugin: [PACKAGE_NAME],
    }

    if (managed) {
        document.server = {
            hostname: "127.0.0.1",
            port: 4096,
        }
    }

    return document
}

export function ensureGatewayPlugin(document: OpencodeConfigDocument): EnsurePluginResult {
    const plugins = document.plugin

    if (plugins === undefined) {
        return {
            changed: true,
            document: {
                ...document,
                plugin: [PACKAGE_NAME],
            },
        }
    }

    if (!Array.isArray(plugins)) {
        throw new Error("opencode.json field `plugin` must be an array when present")
    }

    if (plugins.some((entry) => entry === PACKAGE_NAME)) {
        return {
            changed: false,
            document,
        }
    }

    return {
        changed: true,
        document: {
            ...document,
            plugin: [...plugins, PACKAGE_NAME],
        },
    }
}

export function parseOpencodeConfig(source: string, path: string): OpencodeConfigDocument {
    let parsed: unknown

    try {
        parsed = JSON.parse(source)
    } catch (error) {
        throw new Error(`failed to parse opencode config ${path}: ${formatError(error)}`)
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`opencode config ${path} must decode to a JSON object`)
    }

    return parsed as OpencodeConfigDocument
}

export function stringifyOpencodeConfig(document: OpencodeConfigDocument): string {
    return `${JSON.stringify(document, null, 2)}\n`
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
