import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayPluginRuntime, GatewayPluginStatus } from "../gateway"

export function createGatewayStatusTool(runtime: GatewayPluginRuntime): ToolDefinition {
    return tool({
        description: "Return the current Rust gateway contract status",
        args: {},
        async execute() {
            return formatGatewayStatus(runtime.status())
        },
    })
}

function formatGatewayStatus(status: GatewayPluginStatus): string {
    return [
        `runtime_mode=${status.runtimeMode}`,
        `supports_telegram=${status.supportsTelegram}`,
        `supports_cron=${status.supportsCron}`,
        `has_web_ui=${status.hasWebUi}`,
        `telegram_enabled=${status.telegramEnabled}`,
        `telegram_polling=${status.telegramPolling}`,
        `telegram_allowlist_mode=${status.telegramAllowlistMode}`,
    ].join("\n")
}
