import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { codeFence } from "../memory/files"
import type { GatewaySessionSearchResult, GatewaySessionSearchRuntime } from "../session/search"

export function createSessionSearchTool(runtime: Pick<GatewaySessionSearchRuntime, "search">): ToolDefinition {
    return tool({
        description:
            "Search across gateway-managed OpenCode sessions. Returns matching snippets, session metadata, and message references.",
        args: {
            query: tool.schema.string().min(1),
            session_id: tool.schema.string().optional(),
            limit: tool.schema.number().optional(),
            message_limit: tool.schema.number().optional(),
        },
        async execute(args) {
            return formatSessionSearchResult(
                await runtime.search(args.query, {
                    sessionId: args.session_id ?? null,
                    limit: args.limit,
                    messageLimit: args.message_limit,
                }),
            )
        },
    })
}

function formatSessionSearchResult(result: GatewaySessionSearchResult): string {
    const sections = [
        `query=${result.query}`,
        `scanned_sessions=${result.scannedSessions}`,
        `skipped_deleted_sessions=${formatStringList(result.skippedDeletedSessionIds)}`,
        `maybe_truncated_sessions=${formatStringList(result.maybeTruncatedSessionIds)}`,
        `hit_count=${result.hits.length}`,
    ]

    if (result.hits.length === 0) {
        return [...sections, "no session matches"].join("\n")
    }

    return [
        ...sections,
        "",
        ...result.hits.flatMap((hit, index) => formatSessionSearchHit(hit, index + 1)),
    ].join("\n")
}

function formatSessionSearchHit(
    hit: GatewaySessionSearchResult["hits"][number],
    ordinal: number,
): string[] {
    return [
        `result[${ordinal}].session_id=${hit.sessionId}`,
        `result[${ordinal}].conversation_key=${hit.conversationKey}`,
        `result[${ordinal}].session_title=${hit.sessionTitle}`,
        `result[${ordinal}].session_created_at_ms=${hit.sessionCreatedAtMs}`,
        `result[${ordinal}].session_updated_at_ms=${hit.sessionUpdatedAtMs}`,
        `result[${ordinal}].message_id=${hit.messageId}`,
        `result[${ordinal}].role=${hit.role}`,
        `result[${ordinal}].part_type=${hit.partType}`,
        `result[${ordinal}].matched_field=${hit.matchedField}`,
        `result[${ordinal}].matched_at_ms=${hit.matchedAtMs ?? "none"}`,
        `result[${ordinal}].snippet:`,
        codeFence("text", hit.snippet),
        "",
    ]
}

function formatStringList(values: string[]): string {
    return values.length === 0 ? "none" : values.join(",")
}
