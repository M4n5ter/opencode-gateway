import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import {
    formatAgentList,
    type GatewayConversationAgentSwitchResult,
    type GatewaySessionAgentRuntime,
} from "../session/agent"

export function createAgentSwitchTool(
    runtime: Pick<GatewaySessionAgentRuntime, "switchAgentForSession">,
): ToolDefinition {
    return tool({
        description:
            "Switch the OpenCode primary agent for the current gateway route. The new agent applies on the next inbound message.",
        args: {
            agent: tool.schema.string().min(1),
        },
        async execute(args, context) {
            return formatAgentSwitchResult(await runtime.switchAgentForSession(context.sessionID, args.agent))
        },
    })
}

function formatAgentSwitchResult(result: GatewayConversationAgentSwitchResult): string {
    return [
        `conversation_key=${result.conversationKey}`,
        `previous_effective_primary_agent=${result.previousEffectivePrimaryAgent}`,
        `previous_route_override_agent=${result.previousRouteOverrideAgent ?? "none"}`,
        `effective_primary_agent=${result.effectivePrimaryAgent}`,
        `source=${result.source}`,
        `route_override_agent=${result.routeOverrideAgent ?? "none"}`,
        `route_override_valid=${result.routeOverrideValid}`,
        `default_primary_agent=${result.defaultPrimaryAgent}`,
        `available_primary_agents=${formatAgentList(result.availablePrimaryAgents)}`,
        `effective_on=${result.effectiveOn}`,
    ].join("\n")
}
