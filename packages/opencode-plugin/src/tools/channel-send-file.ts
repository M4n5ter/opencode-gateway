import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { ChannelFileSendResult } from "../host/file-sender"
import type { GatewaySessionContext } from "../session/context"
import { resolveToolDeliveryTarget } from "./channel-target"

export function createChannelSendFileTool(
    sender: ChannelFileSenderLike,
    sessions: GatewaySessionContext,
): ToolDefinition {
    return tool({
        description:
            "Send a local absolute-path file to a channel target. When called from a channel-backed session, channel, target, and topic default to the current reply target.",
        args: {
            channel: tool.schema.string().min(1).optional(),
            target: tool.schema.string().min(1).optional(),
            topic: tool.schema.string().optional(),
            file_path: tool.schema.string().min(1),
            caption: tool.schema.string().optional(),
        },
        async execute(args, context) {
            return formatChannelFileSendResult(
                await sender.sendFile(
                    resolveToolDeliveryTarget(args, context.sessionID, sessions),
                    args.file_path,
                    args.caption ?? null,
                ),
            )
        },
    })
}

function formatChannelFileSendResult(result: ChannelFileSendResult): string {
    return [
        `channel=${result.channel}`,
        `target=${result.target}`,
        `topic=${result.topic ?? "none"}`,
        `file_path=${result.filePath}`,
        `mime_type=${result.mimeType}`,
        `delivery_kind=${result.deliveryKind}`,
    ].join("\n")
}

type ChannelFileSenderLike = {
    sendFile(
        target: ReturnType<typeof resolveToolDeliveryTarget>,
        filePath: string,
        caption: string | null,
    ): Promise<ChannelFileSendResult>
}
