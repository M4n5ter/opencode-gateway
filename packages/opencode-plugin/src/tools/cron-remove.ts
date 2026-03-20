import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"

export function createCronRemoveTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "Remove a persisted gateway cron job",
        args: {
            id: tool.schema.string().min(1),
        },
        async execute(args) {
            return runtime.removeJob(args.id) ? `removed=${args.id}` : `missing=${args.id}`
        },
    })
}
