import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { formatAgentList, type GatewayConversationAgentStatus, type GatewaySessionAgentRuntime } from "../session/agent"

export function createAgentStatusTool(
    runtime: Pick<GatewaySessionAgentRuntime, "getStatusForSession">,
): ToolDefinition {
    return tool({
        description:
            "Show the current route-scoped OpenCode primary agent, its source, and the available primary agents.",
        args: {},
        async execute(_args, context) {
            return formatAgentStatus(await runtime.getStatusForSession(context.sessionID))
        },
    })
}

function formatAgentStatus(status: GatewayConversationAgentStatus): string {
    return [
        `conversation_key=${status.conversationKey}`,
        `effective_primary_agent=${status.effectivePrimaryAgent}`,
        `source=${status.source}`,
        `route_override_agent=${status.routeOverrideAgent ?? "none"}`,
        `route_override_valid=${status.routeOverrideValid}`,
        `default_primary_agent=${status.defaultPrimaryAgent}`,
        `available_primary_agents=${formatAgentList(status.availablePrimaryAgents)}`,
    ].join("\n")
}
