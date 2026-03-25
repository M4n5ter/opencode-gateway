import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { codeFence } from "../memory/files"
import type { GatewayMemoryRuntime, MemorySearchResult } from "../memory/runtime"

export function createMemorySearchTool(runtime: GatewayMemoryRuntime): ToolDefinition {
    return tool({
        description:
            "Search configured gateway memory files and directories. Returns matching snippets and paths that can be read in more detail with memory_get.",
        args: {
            query: tool.schema.string().min(1),
            limit: tool.schema.number().optional(),
        },
        async execute(args) {
            const results = await runtime.search(args.query, args.limit)
            if (results.length === 0) {
                return "no memory matches"
            }

            return results.map((result, index) => formatMemorySearchResult(result, index + 1)).join("\n\n")
        },
    })
}

function formatMemorySearchResult(result: MemorySearchResult, ordinal: number): string {
    return [
        `result[${ordinal}].path=${result.path}`,
        `result[${ordinal}].description=${result.description}`,
        `result[${ordinal}].line_start=${result.lineStart}`,
        `result[${ordinal}].line_end=${result.lineEnd}`,
        `result[${ordinal}].snippet:`,
        codeFence(result.infoString, result.snippet),
    ].join("\n")
}
