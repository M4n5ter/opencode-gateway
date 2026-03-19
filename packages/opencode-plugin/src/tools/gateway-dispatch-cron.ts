import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { BindingCronJobSpec, BindingRuntimeReport, GatewayBindingHandle } from "../binding"

export function createGatewayDispatchCronTool(binding: GatewayBindingHandle): ToolDefinition {
    return tool({
        description: "Dispatch one gateway cron-style prompt through the Rust runtime",
        args: {
            id: tool.schema.string().min(1),
            schedule: tool.schema.string().min(1),
            prompt: tool.schema.string().min(1),
        },
        async execute(args) {
            const report = await binding.dispatchCronJob(toCronJobSpec(args))
            return formatRuntimeReport(report)
        },
    })
}

function toCronJobSpec(args: { id: string; schedule: string; prompt: string }): BindingCronJobSpec {
    return {
        id: args.id,
        schedule: args.schedule,
        prompt: args.prompt,
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
