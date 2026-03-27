import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { BindingDispatchReport } from "../binding"
import type { GatewayCronRuntime } from "../cron/runtime"

export function createCronRunTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "Run one persisted gateway schedule job immediately without changing its schedule metadata.",
        args: {
            id: tool.schema.string().min(1),
        },
        async execute(args) {
            return formatRuntimeReport(await runtime.runNow(args.id))
        },
    })
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
