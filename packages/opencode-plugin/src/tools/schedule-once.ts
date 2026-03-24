import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import type { GatewaySessionContext } from "../session/context"
import { resolveOptionalToolDeliveryTarget } from "./channel-target"
import { formatScheduleJob } from "./schedule-format"

export function createScheduleOnceTool(runtime: GatewayCronRuntime, sessions: GatewaySessionContext): ToolDefinition {
    return tool({
        description:
            "Schedule a one-shot gateway job. When called from a channel-backed session, delivery defaults to the current reply target.",
        args: {
            id: tool.schema.string().min(1),
            prompt: tool.schema.string().min(1),
            delay_seconds: tool.schema.number().optional(),
            run_at_ms: tool.schema.number().optional(),
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
            const job = runtime.scheduleOnce({
                id: args.id,
                prompt: args.prompt,
                delaySeconds: normalizeOptionalInteger(args.delay_seconds, "delay_seconds"),
                runAtMs: normalizeOptionalInteger(args.run_at_ms, "run_at_ms"),
                deliveryChannel: deliveryTarget?.channel ?? null,
                deliveryTarget: deliveryTarget?.target ?? null,
                deliveryTopic: deliveryTarget?.topic ?? null,
            })

            return formatScheduleJob(job, runtime.timeZone())
        },
    })
}

function normalizeOptionalInteger(value: number | undefined, field: string): number | null {
    if (value === undefined) {
        return null
    }

    if (!Number.isSafeInteger(value)) {
        throw new Error(`${field} must be an integer`)
    }

    return value
}
