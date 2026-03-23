import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewaySessionContext } from "../session/context"
import type { ChannelSessionSwitcher, ChannelSessionSwitchResult } from "../session/switcher"
import { resolveToolDeliveryTarget } from "./channel-target"

export function createChannelNewSessionTool(
    switcher: Pick<ChannelSessionSwitcher, "createAndSwitchSession">,
    sessions: GatewaySessionContext,
): ToolDefinition {
    return tool({
        description:
            "Create a fresh OpenCode session for a channel route and switch future inbound messages to it. When called from a channel-backed session, channel, target, and topic default to the current reply target.",
        args: {
            channel: tool.schema.string().min(1).optional(),
            target: tool.schema.string().min(1).optional(),
            topic: tool.schema.string().optional(),
            title: tool.schema.string().optional(),
        },
        async execute(args, context) {
            return formatChannelSessionSwitchResult(
                await switcher.createAndSwitchSession(
                    resolveToolDeliveryTarget(args, context.sessionID, sessions),
                    args.title ?? null,
                ),
            )
        },
    })
}

function formatChannelSessionSwitchResult(result: ChannelSessionSwitchResult): string {
    return [
        `channel=${result.channel}`,
        `target=${result.target}`,
        `topic=${result.topic ?? "none"}`,
        `conversation_key=${result.conversationKey}`,
        `previous_session_id=${result.previousSessionId ?? "none"}`,
        `new_session_id=${result.newSessionId}`,
        `effective_on=${result.effectiveOn}`,
    ].join("\n")
}
