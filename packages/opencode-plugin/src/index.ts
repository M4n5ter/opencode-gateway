import type { Plugin } from "@opencode-ai/plugin"

import { loadGatewayBindingModule } from "./binding"
import { createGatewayBinding } from "./gateway"
import { createGatewayDispatchCronTool } from "./tools/gateway-dispatch-cron"
import { createGatewayStatusTool } from "./tools/gateway-status"

/**
 * Minimal plugin scaffold that loads the BoltFFI-generated gateway binding and exposes
 * one read-only status tool plus one execution-style debug tool.
 */
export const OpencodeGatewayPlugin: Plugin = async (input) => {
    const gatewayModule = await loadGatewayBindingModule()
    const binding = await createGatewayBinding(gatewayModule, input)

    return {
        tool: {
            gateway_status: createGatewayStatusTool(binding),
            gateway_dispatch_cron: createGatewayDispatchCronTool(binding),
        },
    }
}

export default OpencodeGatewayPlugin
