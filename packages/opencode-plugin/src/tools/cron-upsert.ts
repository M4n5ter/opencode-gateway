import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import { formatUnixMsAsUtc } from "./time"

export function createCronUpsertTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "Create or replace a persisted gateway cron job. The schedule is interpreted in UTC.",
        args: {
            id: tool.schema.string().min(1),
            schedule: tool.schema.string().min(1),
            prompt: tool.schema.string().min(1),
            enabled: tool.schema.boolean().optional(),
            delivery_channel: tool.schema.string().optional(),
            delivery_target: tool.schema.string().optional(),
            delivery_topic: tool.schema.string().optional(),
        },
        async execute(args) {
            const job = runtime.upsertJob({
                id: args.id,
                schedule: args.schedule,
                prompt: args.prompt,
                enabled: args.enabled ?? true,
                deliveryChannel: args.delivery_channel ?? null,
                deliveryTarget: args.delivery_target ?? null,
                deliveryTopic: args.delivery_topic ?? null,
            })

            return [
                `id=${job.id}`,
                `enabled=${job.enabled}`,
                `schedule=${job.schedule}`,
                `next_run_at_ms=${job.nextRunAtMs}`,
                `next_run_at_utc=${formatUnixMsAsUtc(job.nextRunAtMs)}`,
            ].join("\n")
        },
    })
}
