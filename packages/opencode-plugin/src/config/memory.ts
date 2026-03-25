import { stat } from "node:fs/promises"
import { resolve } from "node:path"

export type GatewayMemoryConfig = {
    entries: GatewayMemoryEntryConfig[]
}

export type GatewayMemoryEntryConfig =
    | {
          kind: "file"
          path: string
          displayPath: string
          description: string
          injectContent: boolean
      }
    | {
          kind: "directory"
          path: string
          displayPath: string
          description: string
          injectMarkdownContents: boolean
          globs: string[]
      }

type RawMemoryConfig = {
    entries?: unknown
}

type RawMemoryEntryConfig = {
    path?: unknown
    description?: unknown
    inject_content?: unknown
    inject_markdown_contents?: unknown
    globs?: unknown
}

export async function parseMemoryConfig(value: unknown, workspaceDirPath: string): Promise<GatewayMemoryConfig> {
    const table = readMemoryTable(value)
    const entries = await readMemoryEntries(table.entries, workspaceDirPath)
    return { entries }
}

function readMemoryTable(value: unknown): RawMemoryConfig {
    if (value === undefined) {
        return {}
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("memory must be a table when present")
    }

    return value as RawMemoryConfig
}

async function readMemoryEntries(value: unknown, workspaceDirPath: string): Promise<GatewayMemoryEntryConfig[]> {
    if (value === undefined) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new Error("memory.entries must be an array when present")
    }

    return await Promise.all(value.map((entry, index) => readMemoryEntry(entry, index, workspaceDirPath)))
}

async function readMemoryEntry(
    value: unknown,
    index: number,
    workspaceDirPath: string,
): Promise<GatewayMemoryEntryConfig> {
    const field = `memory.entries[${index}]`
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} must be a table`)
    }

    const entry = value as RawMemoryEntryConfig
    const displayPath = readRequiredString(entry.path, `${field}.path`)
    const description = readRequiredString(entry.description, `${field}.description`)
    const resolvedPath = resolve(workspaceDirPath, displayPath)
    const metadata = await statPath(resolvedPath, `${field}.path`)

    if (metadata.isFile()) {
        ensureDirectoryOnlyFieldIsAbsent(entry.inject_markdown_contents, `${field}.inject_markdown_contents`)
        ensureDirectoryOnlyFieldIsAbsent(entry.globs, `${field}.globs`)

        return {
            kind: "file",
            path: resolvedPath,
            displayPath,
            description,
            injectContent: readBoolean(entry.inject_content, `${field}.inject_content`, false),
        }
    }

    if (metadata.isDirectory()) {
        ensureFileOnlyFieldIsAbsent(entry.inject_content, `${field}.inject_content`)

        return {
            kind: "directory",
            path: resolvedPath,
            displayPath,
            description,
            injectMarkdownContents: readBoolean(
                entry.inject_markdown_contents,
                `${field}.inject_markdown_contents`,
                false,
            ),
            globs: readGlobList(entry.globs, `${field}.globs`),
        }
    }

    throw new Error(`${field}.path must point to a regular file or directory`)
}

async function statPath(path: string, field: string) {
    try {
        return await stat(path)
    } catch (error) {
        throw new Error(`${field} does not exist: ${path}`, { cause: error })
    }
}

function ensureDirectoryOnlyFieldIsAbsent(value: unknown, field: string): void {
    if (value !== undefined) {
        throw new Error(`${field} is only valid for directory entries`)
    }
}

function ensureFileOnlyFieldIsAbsent(value: unknown, field: string): void {
    if (value !== undefined) {
        throw new Error(`${field} is only valid for file entries`)
    }
}

function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "boolean") {
        throw new Error(`${field} must be a boolean when present`)
    }

    return value
}

function readGlobList(value: unknown, field: string): string[] {
    if (value === undefined) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new Error(`${field} must be an array when present`)
    }

    return value.map((entry, index) => readRequiredString(entry, `${field}[${index}]`))
}

function readRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`)
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}
