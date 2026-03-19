import { type Plugin, tool } from "@opencode-ai/plugin";

import { type GatewayStatusSnapshot, loadGatewayBindingModule } from "./binding";

function formatGatewayStatus(status: GatewayStatusSnapshot): string {
  return [
    `runtime_mode=${status.runtimeMode}`,
    `supports_telegram=${status.supportsTelegram}`,
    `supports_cron=${status.supportsCron}`,
    `has_web_ui=${status.hasWebUi}`,
  ].join("\n");
}

/**
 * Minimal plugin scaffold that loads the BoltFFI-generated gateway binding and exposes a
 * single read-only debug tool.
 */
export const OpencodeGatewayPlugin: Plugin = async (_context) => {
  const bindingModule = await loadGatewayBindingModule();

  return {
    tool: {
      gateway_status: tool({
        description: "Return the current Rust gateway contract status",
        args: {},
        async execute() {
          return formatGatewayStatus(bindingModule.gatewayStatus());
        },
      }),
    },
  };
};

export default OpencodeGatewayPlugin;
