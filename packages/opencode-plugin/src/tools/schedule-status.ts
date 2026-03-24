import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import { formatScheduleStatus } from "./schedule-format"

export function createScheduleStatusTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "Inspect one persisted gateway schedule job and its recent run history.",
        args: {
            id: tool.schema.string().min(1),
            limit: tool.schema.number().optional(),
        },
        async execute(args) {
            return formatScheduleStatus(
                runtime.getJobStatus(args.id, normalizeOptionalLimit(args.limit)),
                runtime.timeZone(),
            )
        },
    })
}

function normalizeOptionalLimit(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined
    }

    if (!Number.isSafeInteger(value)) {
        throw new Error("limit must be an integer")
    }

    return value
}
