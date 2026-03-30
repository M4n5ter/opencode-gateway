import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayRestartRequestResult, GatewayRestartRuntime } from "../runtime/restart"

export function createGatewayRestartTool(runtime: Pick<GatewayRestartRuntime, "scheduleRestart">): ToolDefinition {
    return tool({
        description:
            "Schedule a managed OpenCode server restart after the current work goes idle so new skills, agents, or config changes take effect. Use this instead of telling the user to restart manually when the gateway is managing OpenCode.",
        args: {},
        async execute() {
            return formatGatewayRestartResult(await runtime.scheduleRestart())
        },
    })
}

function formatGatewayRestartResult(result: GatewayRestartRequestResult): string {
    return [
        `status=${result.status}`,
        `behavior=${result.behavior}`,
        `scope=${result.scope}`,
        `effective_on=${result.effectiveOn}`,
        `requested_at_ms=${result.requestedAtMs}`,
        "note=managed restart requested; the gateway will restart OpenCode on the user's behalf once current work goes idle",
    ].join("\n")
}
