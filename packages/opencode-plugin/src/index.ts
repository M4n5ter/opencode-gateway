import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"

import { loadGatewayBindingModule } from "./binding"
import { createGatewayRuntime } from "./gateway"
import { createChannelNewSessionTool } from "./tools/channel-new-session"
import { createChannelSendFileTool } from "./tools/channel-send-file"
import { createCronRunTool } from "./tools/cron-run"
import { createCronUpsertTool } from "./tools/cron-upsert"
import { createGatewayDispatchCronTool } from "./tools/gateway-dispatch-cron"
import { createGatewayStatusTool } from "./tools/gateway-status"
import { createScheduleCancelTool } from "./tools/schedule-cancel"
import { createScheduleListTool } from "./tools/schedule-list"
import { createScheduleOnceTool } from "./tools/schedule-once"
import { createScheduleStatusTool } from "./tools/schedule-status"
import { createTelegramSendTestTool } from "./tools/telegram-send-test"
import { createTelegramStatusTool } from "./tools/telegram-status"

/**
 * OpenCode plugin entrypoint that loads the local wasm binding and exposes the
 * gateway, cron, and Telegram operational tools.
 */
export const OpencodeGatewayPlugin: Plugin = async (input) => {
    const gatewayModule = await loadGatewayBindingModule()
    const runtime = await createGatewayRuntime(gatewayModule, input)
    const tools: Record<string, ToolDefinition> = {
        cron_run: createCronRunTool(runtime.cron),
        cron_upsert: createCronUpsertTool(runtime.cron, runtime.sessionContext),
        gateway_status: createGatewayStatusTool(runtime),
        gateway_dispatch_cron: createGatewayDispatchCronTool(runtime.executor),
        schedule_cancel: createScheduleCancelTool(runtime.cron),
        schedule_list: createScheduleListTool(runtime.cron),
        schedule_once: createScheduleOnceTool(runtime.cron, runtime.sessionContext),
        schedule_status: createScheduleStatusTool(runtime.cron),
    }

    if (runtime.files.hasEnabledChannel()) {
        tools.channel_send_file = createChannelSendFileTool(runtime.files, runtime.sessionContext)
    }

    if (runtime.channelSessions.hasEnabledChannel()) {
        tools.channel_new_session = createChannelNewSessionTool(runtime.channelSessions, runtime.sessionContext)
    }

    if (runtime.telegram.isEnabled()) {
        tools.telegram_status = createTelegramStatusTool(runtime.telegram)
        tools.telegram_send_test = createTelegramSendTestTool(runtime.telegram)
    }

    return {
        tool: tools,
        "experimental.chat.system.transform": async (input, output) => {
            const sessionId = input.sessionID
            if (!sessionId) {
                return
            }

            const systemPrompt = runtime.sessionContext.buildSystemPrompt(sessionId)
            if (systemPrompt !== null) {
                output.system.push(systemPrompt)
            }
        },
    }
}

export default OpencodeGatewayPlugin
