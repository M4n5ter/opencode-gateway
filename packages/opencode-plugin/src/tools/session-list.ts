import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewaySessionListResult, GatewaySessionSearchRuntime } from "../session/search"

export function createSessionListTool(runtime: Pick<GatewaySessionSearchRuntime, "list">): ToolDefinition {
    return tool({
        description:
            "List gateway-managed OpenCode sessions with pagination. By default only active sessions are returned; deleted historical sessions can be included explicitly.",
        args: {
            offset: tool.schema.number().optional(),
            limit: tool.schema.number().optional(),
            include_deleted: tool.schema.boolean().optional(),
        },
        async execute(args) {
            return formatSessionListResult(
                await runtime.list({
                    offset: args.offset,
                    limit: args.limit,
                    includeDeleted: args.include_deleted,
                }),
            )
        },
    })
}

function formatSessionListResult(result: GatewaySessionListResult): string {
    const lines = [
        `offset=${result.offset}`,
        `limit=${result.limit}`,
        `returned_count=${result.returnedCount}`,
        `total_count=${result.totalCount}`,
        `next_offset=${result.nextOffset ?? "none"}`,
        `prev_offset=${result.prevOffset ?? "none"}`,
        `active_count=${result.activeCount}`,
        `deleted_count=${result.deletedCount}`,
    ]

    if (result.sessions.length === 0) {
        return [...lines, "no gateway sessions"].join("\n")
    }

    return [
        ...lines,
        "",
        ...result.sessions.flatMap((session, index) => formatSessionListEntry(session, index + 1)),
    ].join("\n")
}

function formatSessionListEntry(entry: GatewaySessionListResult["sessions"][number], ordinal: number): string[] {
    return [
        `session[${ordinal}].session_id=${entry.sessionId}`,
        `session[${ordinal}].conversation_key=${entry.conversationKey}`,
        `session[${ordinal}].status=${entry.status}`,
        `session[${ordinal}].is_current_binding=${entry.isCurrentBinding}`,
        `session[${ordinal}].last_tracked_at_ms=${entry.lastTrackedAtMs}`,
        `session[${ordinal}].session_title=${entry.sessionTitle ?? "none"}`,
        `session[${ordinal}].parent_session_id=${entry.parentSessionId ?? "none"}`,
        `session[${ordinal}].session_created_at_ms=${entry.sessionCreatedAtMs ?? "none"}`,
        `session[${ordinal}].session_updated_at_ms=${entry.sessionUpdatedAtMs ?? "none"}`,
        "",
    ]
}
