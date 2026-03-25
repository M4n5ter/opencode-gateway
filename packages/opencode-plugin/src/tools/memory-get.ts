import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { codeFence } from "../memory/files"
import type { GatewayMemoryRuntime, MemoryGetResult } from "../memory/runtime"

export function createMemoryGetTool(runtime: GatewayMemoryRuntime): ToolDefinition {
    return tool({
        description:
            "Read a configured gateway memory file by path. Use the path returned by memory_search or a configured file path.",
        args: {
            path: tool.schema.string().min(1),
            start_line: tool.schema.number().optional(),
            max_lines: tool.schema.number().optional(),
        },
        async execute(args) {
            return formatMemoryGetResult(await runtime.get(args.path, args.start_line, args.max_lines))
        },
    })
}

function formatMemoryGetResult(result: MemoryGetResult): string {
    return [
        `path=${result.path}`,
        `description=${result.description}`,
        `line_start=${result.lineStart}`,
        `line_end=${result.lineEnd}`,
        "content:",
        codeFence(result.infoString, result.text),
    ].join("\n")
}
