const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json"
const PACKAGE_NAME = "opencode-gateway"
const PACKAGE_SPEC = "opencode-gateway@latest"

type OpencodeConfigDocument = Record<string, unknown>

export type EnsurePluginResult = {
    changed: boolean
    document: OpencodeConfigDocument
}

export type GatewayPluginStatus = "yes" | "no" | "needs_update"

export function createDefaultOpencodeConfig(managed: boolean): OpencodeConfigDocument {
    const document: OpencodeConfigDocument = {
        $schema: OPENCODE_SCHEMA_URL,
        plugin: [PACKAGE_SPEC],
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
    const plugins = readPluginArray(document)

    if (plugins === undefined) {
        return {
            changed: true,
            document: {
                ...document,
                plugin: [PACKAGE_SPEC],
            },
        }
    }

    if (plugins.includes(PACKAGE_SPEC)) {
        return {
            changed: false,
            document,
        }
    }

    return {
        changed: true,
        document: {
            ...document,
            plugin: [...plugins, PACKAGE_SPEC],
        },
    }
}

export function parseOpencodeConfig(source: string, path: string): OpencodeConfigDocument {
    let parsed: unknown

    try {
        parsed = JSON.parse(toStrictJson(source))
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

export function inspectGatewayPlugin(document: OpencodeConfigDocument): GatewayPluginStatus {
    const plugins = readPluginArray(document)
    if (plugins === undefined) {
        return "no"
    }

    if (plugins.includes(PACKAGE_SPEC)) {
        return "yes"
    }

    return plugins.some((entry) => isGatewayPluginReference(entry)) ? "needs_update" : "no"
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function readPluginArray(document: OpencodeConfigDocument): string[] | undefined {
    const plugins = document.plugin
    if (plugins === undefined) {
        return undefined
    }

    if (!Array.isArray(plugins)) {
        throw new Error("opencode config field `plugin` must be an array when present")
    }

    const normalized: string[] = []
    for (const [index, entry] of plugins.entries()) {
        if (typeof entry !== "string") {
            throw new Error(`opencode config field \`plugin[${index}]\` must be a string`)
        }

        normalized.push(entry)
    }

    return normalized
}

function toStrictJson(source: string): string {
    return stripTrailingCommas(stripJsonComments(source))
}

function stripJsonComments(source: string): string {
    let result = ""
    let inString = false
    let escaped = false
    let inLineComment = false
    let inBlockComment = false

    for (let index = 0; index < source.length; index += 1) {
        const current = source[index]
        const next = source[index + 1]

        if (inLineComment) {
            if (current === "\n") {
                inLineComment = false
                result += current
            }
            continue
        }

        if (inBlockComment) {
            if (current === "*" && next === "/") {
                inBlockComment = false
                index += 1
            } else if (current === "\n") {
                result += current
            }
            continue
        }

        if (inString) {
            result += current
            if (escaped) {
                escaped = false
            } else if (current === "\\") {
                escaped = true
            } else if (current === '"') {
                inString = false
            }
            continue
        }

        if (current === '"') {
            inString = true
            result += current
            continue
        }

        if (current === "/" && next === "/") {
            inLineComment = true
            index += 1
            continue
        }

        if (current === "/" && next === "*") {
            inBlockComment = true
            index += 1
            continue
        }

        result += current
    }

    return result
}

function stripTrailingCommas(source: string): string {
    let result = ""
    let inString = false
    let escaped = false

    for (let index = 0; index < source.length; index += 1) {
        const current = source[index]

        if (inString) {
            result += current
            if (escaped) {
                escaped = false
            } else if (current === "\\") {
                escaped = true
            } else if (current === '"') {
                inString = false
            }
            continue
        }

        if (current === '"') {
            inString = true
            result += current
            continue
        }

        if (current === ",") {
            const nextSignificant = findNextSignificantCharacter(source, index + 1)
            if (nextSignificant === "]" || nextSignificant === "}") {
                continue
            }
        }

        result += current
    }

    return result
}

function findNextSignificantCharacter(source: string, startIndex: number): string | null {
    for (let index = startIndex; index < source.length; index += 1) {
        const current = source[index]
        if (!/\s/.test(current)) {
            return current
        }
    }

    return null
}

function isGatewayPluginReference(entry: string): boolean {
    return entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`)
}
