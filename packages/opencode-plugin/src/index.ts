import type { Plugin } from "@opencode-ai/plugin"

import { loadGatewayBindingModule } from "./binding"
import { createGatewayRuntime } from "./gateway"
import { createGatewayDispatchCronTool } from "./tools/gateway-dispatch-cron"
import { createGatewayStatusTool } from "./tools/gateway-status"

/**
 * Minimal plugin scaffold that loads the BoltFFI-generated gateway binding and exposes
 * one read-only status tool plus one execution-style debug tool.
 */
export const OpencodeGatewayPlugin: Plugin = async (input) => {
    const gatewayModule = await loadGatewayBindingModule()
    const runtime = await createGatewayRuntime(gatewayModule, input)

    return {
        tool: {
            gateway_status: createGatewayStatusTool(runtime),
            gateway_dispatch_cron: createGatewayDispatchCronTool(runtime.binding),
        },
    }
}

export default OpencodeGatewayPlugin
