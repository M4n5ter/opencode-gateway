import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"

export function createScheduleCancelTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "Cancel a persisted gateway schedule job without deleting its run history.",
        args: {
            id: tool.schema.string().min(1),
        },
        async execute(args) {
            return runtime.cancelJob(args.id) ? `canceled=${args.id}` : `inactive=${args.id}`
        },
    })
}
