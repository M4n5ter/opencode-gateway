import { mkdir, stat, writeFile } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"

export type GatewayMemoryConfig = {
    entries: GatewayMemoryEntryConfig[]
}

export type GatewayMemoryEntryConfig =
    | {
          kind: "file"
          path: string
          displayPath: string
          description: string
          header?: string | null
          footer?: string | null
          injectContent: boolean
          searchOnly: boolean
      }
    | {
          kind: "directory"
          path: string
          displayPath: string
          description: string
          header?: string | null
          footer?: string | null
          globs: string[]
          searchOnly: boolean
      }

type RawMemoryConfig = {
    entries?: unknown
}

type RawMemoryEntryConfig = {
    path?: unknown
    description?: unknown
    header?: unknown
    footer?: unknown
    inject_content?: unknown
    inject_markdown_contents?: unknown
    globs?: unknown
    search_only?: unknown
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
    if (entry.inject_markdown_contents !== undefined) {
        throw new Error(
            `${field}.inject_markdown_contents has been removed; use globs for directory injection or search_only for on-demand access`,
        )
    }

    const displayPath = readRequiredString(entry.path, `${field}.path`)
    const description = readRequiredString(entry.description, `${field}.description`)
    const header = readOptionalString(entry.header, `${field}.header`)
    const footer = readOptionalString(entry.footer, `${field}.footer`)
    const resolvedPath = resolve(workspaceDirPath, displayPath)
    const metadata = await ensurePathMetadata(resolvedPath, displayPath, entry, `${field}.path`)
    const searchOnly = readBoolean(entry.search_only, `${field}.search_only`, false)

    if (metadata.isFile()) {
        ensureDirectoryOnlyFieldIsAbsent(entry.globs, `${field}.globs`)

        const injectContent = readBoolean(entry.inject_content, `${field}.inject_content`, false)
        if (searchOnly && injectContent) {
            throw new Error(`${field} cannot enable both inject_content and search_only`)
        }

        return {
            kind: "file",
            path: resolvedPath,
            displayPath,
            description,
            header,
            footer,
            injectContent,
            searchOnly,
        }
    }

    if (metadata.isDirectory()) {
        ensureFileOnlyFieldIsAbsent(entry.inject_content, `${field}.inject_content`)
        const globs = readGlobList(entry.globs, `${field}.globs`)
        if (searchOnly && globs.length > 0) {
            throw new Error(`${field} cannot enable both globs and search_only`)
        }

        return {
            kind: "directory",
            path: resolvedPath,
            displayPath,
            description,
            header,
            footer,
            globs,
            searchOnly,
        }
    }

    throw new Error(`${field}.path must point to a regular file or directory`)
}

async function ensurePathMetadata(path: string, displayPath: string, entry: RawMemoryEntryConfig, _field: string) {
    try {
        return await stat(path)
    } catch (error) {
        if (!isMissingPathError(error)) {
            throw error
        }

        const kind = inferMissingEntryKind(displayPath, entry)
        await createMissingEntryPath(path, kind)
        return await stat(path)
    }
}

function isMissingPathError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function inferMissingEntryKind(displayPath: string, entry: RawMemoryEntryConfig): "file" | "directory" {
    if (entry.inject_content !== undefined) {
        return "file"
    }

    if (entry.globs !== undefined) {
        return "directory"
    }

    const trimmedPath = displayPath.trim()
    if (trimmedPath.endsWith("/") || trimmedPath.endsWith("\\")) {
        return "directory"
    }

    const name = basename(trimmedPath)
    if (name.startsWith(".") || extname(name).length > 0) {
        return "file"
    }

    return "directory"
}

async function createMissingEntryPath(path: string, kind: "file" | "directory"): Promise<void> {
    if (kind === "directory") {
        await mkdir(path, { recursive: true })
        return
    }

    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
    const parentPath = lastSlash >= 0 ? path.slice(0, lastSlash) : "."
    await mkdir(parentPath, { recursive: true })
    await writeFile(path, "", { flag: "a" })
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

function readOptionalString(value: unknown, field: string): string | null {
    if (value === undefined) {
        return null
    }

    return readRequiredString(value, field)
}
