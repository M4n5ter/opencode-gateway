import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { codeFence } from "../memory/files"
import type { GatewaySessionSearchRuntime, GatewaySessionViewResult } from "../session/search"

export function createSessionViewTool(runtime: Pick<GatewaySessionSearchRuntime, "view">): ToolDefinition {
    return tool({
        description:
            "View a gateway-managed OpenCode session transcript with offset pagination and explicit content visibility controls.",
        args: {
            session_id: tool.schema.string().optional(),
            offset: tool.schema.number().optional(),
            message_limit: tool.schema.number().optional(),
            include_reasoning: tool.schema.boolean().optional(),
            include_attachments: tool.schema.boolean().optional(),
            include_tools: tool.schema.boolean().optional(),
            include_tool_inputs: tool.schema.boolean().optional(),
            include_tool_outputs: tool.schema.boolean().optional(),
            include_files: tool.schema.boolean().optional(),
            include_subtasks: tool.schema.boolean().optional(),
            include_snapshots: tool.schema.boolean().optional(),
            include_patches: tool.schema.boolean().optional(),
            include_steps: tool.schema.boolean().optional(),
            include_compactions: tool.schema.boolean().optional(),
            include_retries: tool.schema.boolean().optional(),
            include_agent_parts: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
            return formatSessionViewResult(
                await runtime.view({
                    sessionId: args.session_id ?? context.sessionID ?? null,
                    offset: args.offset,
                    messageLimit: args.message_limit,
                    includeReasoning: args.include_reasoning,
                    includeAttachments: args.include_attachments,
                    includeTools: args.include_tools,
                    includeToolInputs: args.include_tool_inputs,
                    includeToolOutputs: args.include_tool_outputs,
                    includeFiles: args.include_files,
                    includeSubtasks: args.include_subtasks,
                    includeSnapshots: args.include_snapshots,
                    includePatches: args.include_patches,
                    includeSteps: args.include_steps,
                    includeCompactions: args.include_compactions,
                    includeRetries: args.include_retries,
                    includeAgentParts: args.include_agent_parts,
                }),
            )
        },
    })
}

function formatSessionViewResult(result: GatewaySessionViewResult): string {
    return [
        `session_id=${result.sessionId}`,
        `conversation_key=${result.conversationKey}`,
        `session_title=${result.sessionTitle}`,
        `parent_session_id=${result.parentSessionId ?? "none"}`,
        `session_created_at_ms=${result.sessionCreatedAtMs}`,
        `session_updated_at_ms=${result.sessionUpdatedAtMs}`,
        `total_message_count=${result.totalMessageCount}`,
        `offset=${result.offset}`,
        `message_limit=${result.messageLimit}`,
        `returned_count=${result.returnedCount}`,
        `next_offset=${result.nextOffset ?? "none"}`,
        `prev_offset=${result.prevOffset ?? "none"}`,
        `visible_parts=${formatStringList(result.visibleParts)}`,
        "",
        ...result.messages.flatMap((message, index) => formatSessionViewMessage(message, index + 1)),
    ].join("\n")
}

function formatSessionViewMessage(message: GatewaySessionViewResult["messages"][number], ordinal: number): string[] {
    const lines = [
        `message[${ordinal}].message_id=${message.messageId}`,
        `message[${ordinal}].role=${message.role}`,
        `message[${ordinal}].parent_id=${message.parentId ?? "none"}`,
        `message[${ordinal}].created_at_ms=${message.createdAtMs ?? "none"}`,
        `message[${ordinal}].visible_part_types=${formatStringList(message.visiblePartTypes)}`,
        `message[${ordinal}].visible_part_count=${message.parts.length}`,
    ]

    if (message.parts.length === 0) {
        return [...lines, `message[${ordinal}].visible_parts=none_after_filters`, ""]
    }

    return [...lines, ...message.parts.flatMap((part, index) => formatSessionViewPart(part, ordinal, index + 1)), ""]
}

function formatSessionViewPart(
    part: GatewaySessionViewResult["messages"][number]["parts"][number],
    messageOrdinal: number,
    partOrdinal: number,
): string[] {
    const lines = [
        `message[${messageOrdinal}].part[${partOrdinal}].type=${part.type}`,
        `message[${messageOrdinal}].part[${partOrdinal}].summary=${part.summary}`,
    ]

    if (part.body === null) {
        return lines
    }

    return [...lines, `message[${messageOrdinal}].part[${partOrdinal}].body:`, codeFence("text", part.body)]
}

function formatStringList(values: string[]): string {
    return values.length === 0 ? "none" : values.join(",")
}
