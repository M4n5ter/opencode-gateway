import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayPluginRuntime, GatewayPluginStatus } from "../gateway"

export function createGatewayStatusTool(runtime: GatewayPluginRuntime): ToolDefinition {
    return tool({
        description: "Return the current Rust gateway contract status",
        args: {},
        async execute() {
            return formatGatewayStatus(await runtime.status())
        },
    })
}

function formatGatewayStatus(status: GatewayPluginStatus): string {
    return [
        `runtime_mode=${status.runtimeMode}`,
        `supports_telegram=${status.supportsTelegram}`,
        `supports_cron=${status.supportsCron}`,
        `has_web_ui=${status.hasWebUi}`,
        `cron_timezone=${status.cronTimezone}`,
        `cron_enabled=${status.cronEnabled}`,
        `cron_polling=${status.cronPolling}`,
        `cron_running_jobs=${status.cronRunningJobs}`,
        `telegram_enabled=${status.telegramEnabled}`,
        `telegram_polling=${status.telegramPolling}`,
        `telegram_allowlist_mode=${status.telegramAllowlistMode}`,
        `restart_supported=${status.restartSupported}`,
        `restart_managed=${status.restartManaged}`,
        `restart_state=${status.restartState}`,
        `restart_pending=${status.restartPending}`,
        `restart_requested_at_ms=${status.restartRequestedAtMs ?? "none"}`,
        `restart_completed_at_ms=${status.restartCompletedAtMs ?? "none"}`,
        `restart_last_error=${status.restartLastError ?? "none"}`,
    ].join("\n")
}
