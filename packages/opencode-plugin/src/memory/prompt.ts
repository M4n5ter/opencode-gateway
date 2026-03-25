import type { BindingLoggerHost } from "../binding"
import type { GatewayMemoryConfig, GatewayMemoryEntryConfig } from "../config/memory"
import { codeFence, collectInjectedMemoryFiles } from "./files"

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
        const lines = [
            `Configured path: ${entry.displayPath}`,
            `Description: ${entry.description}`,
            `Access: ${describeMemoryAccess(entry)}`,
        ]
        const injectedFiles = await collectInjectedMemoryFiles(entry, this.logger)

        if (entry.kind === "directory" && entry.globs.length > 0 && !entry.searchOnly) {
            lines.push(`Auto-injected globs: ${entry.globs.join(", ")}`)
        }

        for (const file of injectedFiles) {
            lines.push("")
            lines.push(`File: ${file.displayPath}`)
            lines.push(codeFence(file.infoString, file.text))
        }

        return lines.join("\n")
    }
}

function describeMemoryAccess(entry: GatewayMemoryEntryConfig): string {
    if (entry.kind === "file") {
        if (entry.injectContent && !entry.searchOnly) {
            return "auto-injected; use memory_search or memory_get for targeted follow-up"
        }

        return "search-only; use memory_search or memory_get when this file is relevant"
    }

    if (entry.searchOnly) {
        return "search-only; all UTF-8 text files under this directory are available via memory_search or memory_get"
    }

    if (entry.globs.length > 0) {
        return "globs are auto-injected; all UTF-8 text files under this directory remain available via memory_search or memory_get"
    }

    return "search-only by default; use memory_search or memory_get when this directory is relevant"
}
