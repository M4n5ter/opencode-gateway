import { readFile } from "node:fs/promises"
import { extname, relative } from "node:path"

import type { BindingLoggerHost } from "../binding"
import type { GatewayMemoryConfig, GatewayMemoryEntryConfig } from "../config/memory"

const MARKDOWN_GLOBS = ["**/*.md", "**/*.markdown"] as const
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

export class GatewayMemoryPromptProvider {
    constructor(
        private readonly config: GatewayMemoryConfig,
        private readonly logger: Pick<BindingLoggerHost, "log">,
    ) {}

    async buildPrompt(): Promise<string | null> {
        if (this.config.entries.length === 0) {
            return null
        }

        const sections = await Promise.all(this.config.entries.map((entry) => this.buildEntrySection(entry)))
        return ["Gateway memory:", ...sections].join("\n\n")
    }

    private async buildEntrySection(entry: GatewayMemoryEntryConfig): Promise<string> {
        const lines = [`Configured path: ${entry.displayPath}`, `Description: ${entry.description}`]
        const injectedFiles = await collectInjectedFiles(entry, this.logger)

        for (const file of injectedFiles) {
            lines.push("")
            lines.push(`File: ${file.displayPath}`)
            lines.push(codeFence(file.infoString, file.text))
        }

        return lines.join("\n")
    }
}

async function collectInjectedFiles(
    entry: GatewayMemoryEntryConfig,
    logger: Pick<BindingLoggerHost, "log">,
): Promise<InjectedMemoryFile[]> {
    if (entry.kind === "file") {
        if (!entry.injectContent) {
            return []
        }

        const text = await readTextFile(entry.path, logger)
        if (text === null) {
            return []
        }

        return [
            {
                displayPath: entry.displayPath,
                infoString: inferFenceInfoString(entry.path),
                text,
            },
        ]
    }

    const filePaths = new Set<string>()
    if (entry.injectMarkdownContents) {
        for (const pattern of MARKDOWN_GLOBS) {
            addMatchingFiles(filePaths, entry.path, pattern)
        }
    }

    for (const pattern of entry.globs) {
        addMatchingFiles(filePaths, entry.path, pattern)
    }

    const injectedFiles: InjectedMemoryFile[] = []
    for (const filePath of [...filePaths].sort((left, right) => left.localeCompare(right))) {
        const text = await readTextFile(filePath, logger)
        if (text === null) {
            continue
        }

        injectedFiles.push({
            displayPath: relativeDisplayPath(entry.path, entry.displayPath, filePath),
            infoString: inferFenceInfoString(filePath),
            text,
        })
    }

    return injectedFiles
}

function addMatchingFiles(result: Set<string>, cwd: string, pattern: string): void {
    const glob = new Bun.Glob(pattern)
    for (const match of glob.scanSync({ cwd, absolute: true, onlyFiles: true })) {
        result.add(match)
    }
}

async function readTextFile(path: string, logger: Pick<BindingLoggerHost, "log">): Promise<string | null> {
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

function codeFence(infoString: string, text: string): string {
    const language = infoString.length === 0 ? "" : infoString
    return [`\`\`\`${language}`, text, "```"].join("\n")
}

function formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return String(error)
}

type InjectedMemoryFile = {
    displayPath: string
    infoString: string
    text: string
}
