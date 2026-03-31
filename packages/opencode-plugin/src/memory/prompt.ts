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
        const promptSections = ["Gateway memory:"]
        const maintenancePolicy = buildMaintenancePolicy(this.config.entries)
        if (maintenancePolicy !== null) {
            promptSections.push(maintenancePolicy)
        }

        promptSections.push(...sections)
        return promptSections.join("\n\n")
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

        const sectionLines: string[] = []
        if ((entry.header ?? null) !== null) {
            sectionLines.push(entry.header ?? "")
        }

        sectionLines.push(...lines)

        if ((entry.footer ?? null) !== null) {
            sectionLines.push(entry.footer ?? "")
        }

        return sectionLines.join("\n")
    }
}

function buildMaintenancePolicy(entries: GatewayMemoryEntryConfig[]): string | null {
    const configuredPaths = new Set(entries.map((entry) => normalizeMemoryEntryPath(entry.displayPath)))
    const hasUserMemory = configuredPaths.has("user.md")
    const hasRulesMemory = configuredPaths.has("rules.md")
    const hasDailyMemory = configuredPaths.has("memory/daily")

    if (!hasUserMemory && !hasRulesMemory && !hasDailyMemory) {
        return null
    }

    const lines = ["Memory maintenance policy:"]

    if (hasUserMemory) {
        lines.push(
            "- Update `USER.md` proactively when you learn durable user preferences, workflow habits, review expectations, or recurring tool constraints.",
        )
    }

    if (hasRulesMemory) {
        lines.push(
            "- Update `RULES.md` proactively when you confirm durable behavior rules, operating boundaries, or output expectations that should keep applying in future sessions.",
        )
    }

    if (hasDailyMemory) {
        lines.push(
            "- Update `memory/daily/YYYY-MM-DD.md` proactively when meaningful day-specific progress, investigation breadcrumbs, temporary decisions, or short-lived working context should be preserved.",
        )
    }

    if (hasUserMemory || hasRulesMemory) {
        lines.push(
            "- Keep durable memory concise and deduplicated. Do not rewrite it without meaningful new long-lived information.",
        )
    }

    if (hasDailyMemory && (hasUserMemory || hasRulesMemory)) {
        lines.push(
            "- Put one-off task details and day-specific context in daily notes instead of `USER.md` or `RULES.md`.",
        )
    }

    return lines.join("\n")
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

function normalizeMemoryEntryPath(path: string): string {
    const normalized = path.trim().replaceAll("\\", "/")
    const withoutTrailingSlash = normalized.replace(/\/+$/u, "")
    return withoutTrailingSlash.toLowerCase()
}
