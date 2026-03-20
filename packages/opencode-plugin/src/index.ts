import type { Plugin } from "@opencode-ai/plugin"

import { loadGatewayBindingModule } from "./binding"
import { createGatewayRuntime } from "./gateway"
import { createCronListTool } from "./tools/cron-list"
import { createCronRemoveTool } from "./tools/cron-remove"
import { createCronRunTool } from "./tools/cron-run"
import { createCronUpsertTool } from "./tools/cron-upsert"
import { createGatewayDispatchCronTool } from "./tools/gateway-dispatch-cron"
import { createGatewayStatusTool } from "./tools/gateway-status"
import { createTelegramSendTestTool } from "./tools/telegram-send-test"
import { createTelegramStatusTool } from "./tools/telegram-status"

/**
 * OpenCode plugin entrypoint that loads the local wasm binding and exposes the
 * gateway, cron, and Telegram operational tools.
 */
export const OpencodeGatewayPlugin: Plugin = async (input) => {
    const gatewayModule = await loadGatewayBindingModule()
    const runtime = await createGatewayRuntime(gatewayModule, input)

    return {
        tool: {
            cron_list: createCronListTool(runtime.cron),
            cron_remove: createCronRemoveTool(runtime.cron),
            cron_run: createCronRunTool(runtime.cron),
            cron_upsert: createCronUpsertTool(runtime.cron),
            gateway_status: createGatewayStatusTool(runtime),
            gateway_dispatch_cron: createGatewayDispatchCronTool(runtime.executor),
            telegram_status: createTelegramStatusTool(runtime.telegram),
            telegram_send_test: createTelegramSendTestTool(runtime.telegram),
        },
    }
}

export default OpencodeGatewayPlugin
