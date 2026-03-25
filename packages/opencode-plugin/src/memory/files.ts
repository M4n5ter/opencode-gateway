import { readFile } from "node:fs/promises"
import { extname, relative } from "node:path"
import { globSync } from "fast-glob"

import type { BindingLoggerHost } from "../binding"
import type { GatewayMemoryConfig, GatewayMemoryEntryConfig } from "../config/memory"

const ALL_FILES_GLOB = "**/*"
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

export type SearchableMemoryFile = {
    path: string
    displayPath: string
    description: string
    infoString: string
    text: string
}

export async function collectInjectedMemoryFiles(
    entry: GatewayMemoryEntryConfig,
    logger: Pick<BindingLoggerHost, "log">,
): Promise<SearchableMemoryFile[]> {
    if (entry.kind === "file") {
        if (entry.searchOnly || !entry.injectContent) {
            return []
        }

        const text = await readMemoryTextFile(entry.path, logger)
        if (text === null) {
            return []
        }

        return [
            {
                path: entry.path,
                displayPath: entry.displayPath,
                description: entry.description,
                infoString: inferFenceInfoString(entry.path),
                text,
            },
        ]
    }

    if (entry.searchOnly || entry.globs.length === 0) {
        return []
    }

    return await readDirectoryFiles(entry, entry.globs, logger)
}

export async function collectSearchableMemoryFiles(
    config: GatewayMemoryConfig,
    logger: Pick<BindingLoggerHost, "log">,
): Promise<SearchableMemoryFile[]> {
    const files: SearchableMemoryFile[] = []

    for (const entry of config.entries) {
        if (entry.kind === "file") {
            const text = await readMemoryTextFile(entry.path, logger)
            if (text === null) {
                continue
            }

            files.push({
                path: entry.path,
                displayPath: entry.displayPath,
                description: entry.description,
                infoString: inferFenceInfoString(entry.path),
                text,
            })
            continue
        }

        files.push(...(await readDirectoryFiles(entry, [ALL_FILES_GLOB], logger)))
    }

    return files
}

export async function readMemoryTextFile(path: string, logger: Pick<BindingLoggerHost, "log">): Promise<string | null> {
    let bytes: Uint8Array

    try {
        bytes = await readFile(path)
    } catch (error) {
        logger.log("warn", `memory file could not be read and will be skipped: ${path}: ${formatError(error)}`)
        return null
    }

    let text: string
    try {
        text = UTF8_TEXT_DECODER.decode(bytes)
    } catch {
        logger.log("warn", `memory file is not valid UTF-8 and will be skipped: ${path}`)
        return null
    }

    if (text.includes("\u0000")) {
        logger.log("warn", `memory file looks binary and will be skipped: ${path}`)
        return null
    }

    return text
}

export function codeFence(infoString: string, text: string): string {
    const language = infoString.length === 0 ? "" : infoString
    return [`\`\`\`${language}`, text, "```"].join("\n")
}

function addMatchingFiles(result: Set<string>, cwd: string, pattern: string): void {
    for (const match of globSync(pattern, { cwd, absolute: true, onlyFiles: true, followSymbolicLinks: false })) {
        result.add(match)
    }
}

async function readDirectoryFiles(
    entry: Extract<GatewayMemoryEntryConfig, { kind: "directory" }>,
    patterns: string[],
    logger: Pick<BindingLoggerHost, "log">,
): Promise<SearchableMemoryFile[]> {
    const filePaths = new Set<string>()
    for (const pattern of patterns) {
        addMatchingFiles(filePaths, entry.path, pattern)
    }

    const files: SearchableMemoryFile[] = []
    for (const filePath of [...filePaths].sort((left, right) => left.localeCompare(right))) {
        const text = await readMemoryTextFile(filePath, logger)
        if (text === null) {
            continue
        }

        files.push({
            path: filePath,
            displayPath: relativeDisplayPath(entry.path, entry.displayPath, filePath),
            description: entry.description,
            infoString: inferFenceInfoString(filePath),
            text,
        })
    }

    return files
}

function relativeDisplayPath(rootPath: string, rootDisplayPath: string, filePath: string): string {
    const suffix = relative(rootPath, filePath)
    if (suffix.length === 0) {
        return rootDisplayPath
    }

    return `${rootDisplayPath}/${suffix.replaceAll("\\", "/")}`
}

function inferFenceInfoString(path: string): string {
    const extension = extname(path).slice(1).toLowerCase()
    if (!/^[a-z0-9_+-]+$/.test(extension)) {
        return ""
    }

    return extension
}

function formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return String(error)
}
