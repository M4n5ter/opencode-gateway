import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { BindingCronJobSpec, BindingDispatchReport } from "../binding"
import type { GatewayExecutorLike } from "../runtime/executor"

export function createGatewayDispatchCronTool(executor: GatewayExecutorLike): ToolDefinition {
    return tool({
        description: "Dispatch one gateway cron-style prompt through the gateway runtime",
        args: {
            id: tool.schema.string().min(1),
            schedule: tool.schema.string().min(1),
            prompt: tool.schema.string().min(1),
        },
        async execute(args) {
            const report = await executor.dispatchCronJob(toCronJobSpec(args))
            return formatRuntimeReport(report)
        },
    })
}

function toCronJobSpec(args: { id: string; schedule: string; prompt: string }): BindingCronJobSpec {
    return {
        id: args.id,
        schedule: args.schedule,
        prompt: args.prompt,
        deliveryChannel: null,
        deliveryTarget: null,
        deliveryTopic: null,
    }
}

function formatRuntimeReport(report: BindingDispatchReport): string {
    return [
        `conversation_key=${report.execution.conversationKey}`,
        `response_text=${report.execution.responseText}`,
        `delivery=${formatDeliveryStatus(report)}`,
        `recorded_at_ms=${report.execution.recordedAtMs}`,
    ].join("\n")
}

function formatDeliveryStatus(report: BindingDispatchReport): string {
    if (report.delivery === null) {
        return "skipped"
    }

    if (report.delivery.failedTargets.length === 0) {
        return "ok"
    }

    if (report.delivery.deliveredTargets.length === 0) {
        return "failed"
    }

    return "partial"
}
