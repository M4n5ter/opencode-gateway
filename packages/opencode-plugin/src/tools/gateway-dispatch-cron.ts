import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { BindingCronJobSpec, BindingRuntimeReport } from "../binding"
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

function formatRuntimeReport(report: BindingRuntimeReport): string {
    return [
        `conversation_key=${report.conversationKey}`,
        `response_text=${report.responseText}`,
        `delivered=${report.delivered}`,
        `recorded_at_ms=${report.recordedAtMs}`,
    ].join("\n")
}
