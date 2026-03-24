import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import type { GatewaySessionContext } from "../session/context"
import { resolveOptionalToolDeliveryTarget } from "./channel-target"
import { formatUnixMsAsUtc, formatUnixMsInTimeZone } from "./time"

export function createCronUpsertTool(runtime: GatewayCronRuntime, sessions: GatewaySessionContext): ToolDefinition {
    return tool({
        description:
            "Create or replace a recurring gateway cron job. When called from a channel-backed session, delivery defaults to the current reply target.",
        args: {
            id: tool.schema.string().min(1),
            schedule: tool.schema.string().min(1),
            prompt: tool.schema.string().min(1),
            enabled: tool.schema.boolean().optional(),
            delivery_channel: tool.schema.string().optional(),
            delivery_target: tool.schema.string().optional(),
            delivery_topic: tool.schema.string().optional(),
        },
        async execute(args, context) {
            const deliveryTarget = resolveOptionalToolDeliveryTarget(
                {
                    channel: args.delivery_channel,
                    target: args.delivery_target,
                    topic: args.delivery_topic,
                },
                context.sessionID,
                sessions,
            )
            const timeZone = runtime.timeZone()
            const job = runtime.upsertJob({
                id: args.id,
                schedule: args.schedule,
                prompt: args.prompt,
                enabled: args.enabled ?? true,
                deliveryChannel: deliveryTarget?.channel ?? null,
                deliveryTarget: deliveryTarget?.target ?? null,
                deliveryTopic: deliveryTarget?.topic ?? null,
            })

            return [
                `id=${job.id}`,
                `kind=${job.kind}`,
                `enabled=${job.enabled}`,
                `schedule=${job.schedule}`,
                `timezone=${timeZone}`,
                `next_run_at_ms=${job.nextRunAtMs}`,
                `next_run_at_local=${formatUnixMsInTimeZone(job.nextRunAtMs, timeZone)}`,
                `next_run_at_utc=${formatUnixMsAsUtc(job.nextRunAtMs)}`,
                `delivery=${formatDelivery(job.deliveryChannel, job.deliveryTarget, job.deliveryTopic)}`,
            ].join("\n")
        },
    })
}

function formatDelivery(channel: string | null, target: string | null, topic: string | null): string {
    if (channel === null || target === null) {
        return "none"
    }

    return topic === null ? `${channel}:${target}` : `${channel}:${target}:topic:${topic}`
}
