import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { BindingDeliveryTarget } from "../binding"
import type { ChannelFileSendResult } from "../host/file-sender"
import type { GatewaySessionContext } from "../session/context"

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
                    resolveDeliveryTarget(args, context.sessionID, sessions),
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

function resolveDeliveryTarget(
    args: {
        channel?: string
        target?: string
        topic?: string
    },
    sessionId: string,
    sessions: GatewaySessionContext,
): BindingDeliveryTarget {
    const fallback = sessions.getDefaultReplyTarget(sessionId)
    const channel = normalizeRequired(args.channel ?? fallback?.channel ?? null, "channel")
    const target = normalizeRequired(args.target ?? fallback?.target ?? null, "target")
    const topic = normalizeOptional(args.topic ?? fallback?.topic ?? null)

    return {
        channel,
        target,
        topic,
    }
}

function normalizeRequired(value: string | null, field: string): string {
    if (value === null) {
        throw new Error(`${field} is required when the current session has no default reply target`)
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function normalizeOptional(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

type ChannelFileSenderLike = {
    sendFile(target: BindingDeliveryTarget, filePath: string, caption: string | null): Promise<ChannelFileSendResult>
}
