import { dirname, join } from "node:path"
import { FileFinder } from "@ff-labs/fff-node"

import type { BindingLoggerHost } from "../binding"
import type { GatewayMemoryConfig, GatewayMemoryEntryConfig } from "../config/memory"
import { collectSearchableMemoryFiles } from "./files"

const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 20
const DEFAULT_GET_MAX_LINES = 200
const MAX_GET_MAX_LINES = 500
const SEARCH_CONTEXT_RADIUS = 1
const SEARCH_SCAN_TIMEOUT_MS = 5_000

export type MemorySearchResult = {
    path: string
    description: string
    lineStart: number
    lineEnd: number
    snippet: string
    infoString: string
}

export type MemoryGetResult = {
    path: string
    description: string
    lineStart: number
    lineEnd: number
    text: string
    infoString: string
}

export class GatewayMemoryRuntime {
    private readonly finderCache = new Map<string, FileFinder>()

    constructor(
        private readonly config: GatewayMemoryConfig,
        private readonly logger: Pick<BindingLoggerHost, "log">,
    ) {}

    hasEntries(): boolean {
        return this.config.entries.length > 0
    }

    async search(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<MemorySearchResult[]> {
        const normalizedQuery = normalizeRequiredString(query, "query")
        const normalizedLimit = normalizePositiveInteger(limit, "limit", MAX_SEARCH_LIMIT)
        const searchableFiles = await collectSearchableMemoryFiles(this.config, this.logger)
        const searchableFilesByPath = new Map(searchableFiles.map((file) => [file.path, file]))
        const results: MemorySearchResult[] = []

        for (const entry of this.config.entries) {
            const finder = await this.getFinder(searchRootForEntry(entry))
            const grep = finder.grep(normalizedQuery, {
                mode: "plain",
                beforeContext: SEARCH_CONTEXT_RADIUS,
                afterContext: SEARCH_CONTEXT_RADIUS,
            })

            if (!grep.ok) {
                throw new Error(`memory search failed for ${entry.displayPath}: ${grep.error}`)
            }

            for (const match of grep.value.items) {
                const matchPath = absolutePathForMatch(entry, match.relativePath)
                if (entry.kind === "file" && matchPath !== entry.path) {
                    continue
                }

                const searchableFile = searchableFilesByPath.get(matchPath)
                if (searchableFile === undefined) {
                    continue
                }

                const window = readSnippetWindow(searchableFile.text, match.lineNumber, SEARCH_CONTEXT_RADIUS)

                results.push({
                    path: displayPathForMatch(entry, match.relativePath),
                    description: entry.description,
                    lineStart: window.lineStart,
                    lineEnd: window.lineEnd,
                    snippet: window.text,
                    infoString: searchableFile.infoString,
                })

                if (results.length >= normalizedLimit) {
                    return results
                }
            }
        }

        return results
    }

    async get(path: string, startLine = 1, maxLines = DEFAULT_GET_MAX_LINES): Promise<MemoryGetResult> {
        const normalizedPath = normalizeRequiredString(path, "path")
        const normalizedStartLine = normalizePositiveInteger(startLine, "start_line")
        const normalizedMaxLines = normalizePositiveInteger(maxLines, "max_lines", MAX_GET_MAX_LINES)
        const files = await collectSearchableMemoryFiles(this.config, this.logger)
        const matches = files.filter((file) => file.displayPath === normalizedPath)

        if (matches.length === 0) {
            throw new Error(`memory path was not found: ${normalizedPath}`)
        }

        if (matches.length > 1) {
            throw new Error(`memory path is ambiguous: ${normalizedPath}`)
        }

        const file = matches[0]
        const lines = splitLines(file.text)
        if (normalizedStartLine > lines.length) {
            throw new Error(
                `start_line ${normalizedStartLine} exceeds the file length of ${lines.length} line(s) for ${normalizedPath}`,
            )
        }

        const startIndex = normalizedStartLine - 1
        const window = lines.slice(startIndex, startIndex + normalizedMaxLines)

        return {
            path: file.displayPath,
            description: file.description,
            lineStart: normalizedStartLine,
            lineEnd: startIndex + window.length,
            text: window.join("\n"),
            infoString: file.infoString,
        }
    }

    private async getFinder(rootPath: string): Promise<FileFinder> {
        const cached = this.finderCache.get(rootPath)
        if (cached !== undefined && !cached.isDestroyed) {
            return cached
        }

        const created = FileFinder.create({
            basePath: rootPath,
            aiMode: true,
        })
        if (!created.ok) {
            throw new Error(`could not initialize memory search index for ${rootPath}: ${created.error}`)
        }

        const finder = created.value
        const ready = await finder.waitForScan(SEARCH_SCAN_TIMEOUT_MS)
        if (!ready.ok) {
            finder.destroy()
            throw new Error(`memory search index failed while waiting for scan: ${ready.error}`)
        }

        if (!ready.value) {
            this.logger.log(
                "warn",
                `memory search scan is still warming after ${SEARCH_SCAN_TIMEOUT_MS}ms: ${rootPath}`,
            )
        }

        this.finderCache.set(rootPath, finder)
        return finder
    }
}

function searchRootForEntry(entry: GatewayMemoryEntryConfig): string {
    return entry.kind === "file" ? dirname(entry.path) : entry.path
}

function displayPathForMatch(entry: GatewayMemoryEntryConfig, relativePath: string): string {
    if (entry.kind === "file") {
        return entry.displayPath
    }

    const normalizedRelativePath = relativePath.replaceAll("\\", "/")
    return normalizedRelativePath.length === 0 ? entry.displayPath : `${entry.displayPath}/${normalizedRelativePath}`
}

function absolutePathForMatch(entry: GatewayMemoryEntryConfig, relativePath: string): string {
    return join(searchRootForEntry(entry), relativePath)
}

function splitLines(text: string): string[] {
    return text.split(/\r?\n/)
}

function readSnippetWindow(text: string, lineNumber: number, contextRadius: number): SnippetWindow {
    const lines = splitLines(text)
    const matchIndex = Math.min(Math.max(lineNumber - 1, 0), Math.max(lines.length - 1, 0))
    const startIndex = Math.max(0, matchIndex - contextRadius)
    const endIndex = Math.min(lines.length - 1, matchIndex + contextRadius)

    return {
        lineStart: startIndex + 1,
        lineEnd: endIndex + 1,
        text: lines.slice(startIndex, endIndex + 1).join("\n"),
    }
}

function normalizePositiveInteger(value: number, field: string, maxValue?: number): number {
    if (!Number.isSafeInteger(value)) {
        throw new Error(`${field} must be an integer`)
    }

    if (value <= 0) {
        throw new Error(`${field} must be greater than 0`)
    }

    if (maxValue !== undefined && value > maxValue) {
        throw new Error(`${field} must be less than or equal to ${maxValue}`)
    }

    return value
}

function normalizeRequiredString(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

type SnippetWindow = {
    lineStart: number
    lineEnd: number
    text: string
}
