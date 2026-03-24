import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { BindingRuntimeReport } from "../binding"
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

function formatRuntimeReport(report: BindingRuntimeReport): string {
    return [
        `conversation_key=${report.conversationKey}`,
        `response_text=${report.responseText}`,
        `delivered=${report.delivered}`,
        `recorded_at_ms=${report.recordedAtMs}`,
    ].join("\n")
}
