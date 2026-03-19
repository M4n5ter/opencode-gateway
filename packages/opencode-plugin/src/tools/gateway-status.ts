import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayStatusSnapshot } from "../binding"

export function createGatewayStatusTool(binding: GatewayBindingHandle): ToolDefinition {
    return tool({
        description: "Return the current Rust gateway contract status",
        args: {},
        async execute() {
            return formatGatewayStatus(binding.status())
        },
    })
}

function formatGatewayStatus(status: GatewayStatusSnapshot): string {
    return [
        `runtime_mode=${status.runtimeMode}`,
        `supports_telegram=${status.supportsTelegram}`,
        `supports_cron=${status.supportsCron}`,
        `has_web_ui=${status.hasWebUi}`,
    ].join("\n")
}
