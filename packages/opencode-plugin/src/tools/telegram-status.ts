import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayTelegramRuntime, GatewayTelegramStatus } from "../telegram/runtime"
import { formatOptionalUnixMsAsUtc } from "./time"

export function createTelegramStatusTool(runtime: GatewayTelegramRuntime): ToolDefinition {
    return tool({
        description: "Return Telegram gateway status, cached health, and a live Bot API probe",
        args: {},
        async execute() {
            return formatTelegramStatus(await runtime.status())
        },
    })
}

function formatTelegramStatus(status: GatewayTelegramStatus): string {
    return [
        `enabled=${status.enabled}`,
        `polling=${status.polling}`,
        `allowlist_mode=${status.allowlistMode}`,
        `allowed_chats_count=${status.allowedChatsCount}`,
        `allowed_users_count=${status.allowedUsersCount}`,
        `update_offset=${status.updateOffset ?? "none"}`,
        `last_poll_success_ms=${status.lastPollSuccessMs ?? "none"}`,
        `last_poll_success_utc=${formatOptionalUnixMsAsUtc(status.lastPollSuccessMs)}`,
        `last_poll_error_at_ms=${status.lastPollErrorAtMs ?? "none"}`,
        `last_poll_error=${status.lastPollErrorMessage ?? "none"}`,
        `last_send_success_ms=${status.lastSendSuccessMs ?? "none"}`,
        `last_send_success_utc=${formatOptionalUnixMsAsUtc(status.lastSendSuccessMs)}`,
        `last_send_error_at_ms=${status.lastSendErrorAtMs ?? "none"}`,
        `last_send_error=${status.lastSendErrorMessage ?? "none"}`,
        `last_probe_success_ms=${status.lastProbeSuccessMs ?? "none"}`,
        `last_probe_success_utc=${formatOptionalUnixMsAsUtc(status.lastProbeSuccessMs)}`,
        `last_probe_error_at_ms=${status.lastProbeErrorAtMs ?? "none"}`,
        `last_probe_error=${status.lastProbeErrorMessage ?? "none"}`,
        `live_probe=${status.liveProbe}`,
        `live_probe_error=${status.liveProbeError ?? "none"}`,
        `bot_id=${status.liveBotId ?? status.lastBotId ?? "none"}`,
        `bot_username=${status.liveBotUsername ?? status.lastBotUsername ?? "none"}`,
        `streaming_enabled=${status.streamingEnabled}`,
        `opencode_event_stream_connected=${status.opencodeEventStreamConnected}`,
        `last_event_stream_error=${status.lastEventStreamError ?? "none"}`,
        `last_stream_success_ms=${status.lastStreamSuccessMs ?? "none"}`,
        `last_stream_success_utc=${formatOptionalUnixMsAsUtc(status.lastStreamSuccessMs)}`,
        `last_stream_error_at_ms=${status.lastStreamErrorAtMs ?? "none"}`,
        `last_stream_error=${status.lastStreamErrorMessage ?? "none"}`,
        `last_preview_emit_ms=${status.lastPreviewEmitMs ?? "none"}`,
        `last_preview_emit_utc=${formatOptionalUnixMsAsUtc(status.lastPreviewEmitMs)}`,
        `last_stream_fallback_at_ms=${status.lastStreamFallbackAtMs ?? "none"}`,
        `last_stream_fallback_utc=${formatOptionalUnixMsAsUtc(status.lastStreamFallbackAtMs)}`,
        `last_stream_fallback_reason=${status.lastStreamFallbackReason ?? "none"}`,
    ].join("\n")
}
