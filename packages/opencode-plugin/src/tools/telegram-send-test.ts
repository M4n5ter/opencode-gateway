import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayTelegramRuntime, TelegramSendTestResult } from "../telegram/runtime"
import { formatUnixMsAsUtc } from "./time"

export function createTelegramSendTestTool(runtime: GatewayTelegramRuntime): ToolDefinition {
    return tool({
        description: "Send a Telegram test message to an explicit chat_id and optional topic",
        args: {
            chat_id: tool.schema.string().min(1),
            topic: tool.schema.string().optional(),
            text: tool.schema.string().optional(),
        },
        async execute(args) {
            return formatTelegramSendTestResult(
                await runtime.sendTest(args.chat_id, args.topic ?? null, args.text ?? null),
            )
        },
    })
}

function formatTelegramSendTestResult(result: TelegramSendTestResult): string {
    return [
        `chat_id=${result.chatId}`,
        `topic=${result.topic ?? "none"}`,
        `sent_at_ms=${result.sentAtMs}`,
        `sent_at_utc=${formatUnixMsAsUtc(result.sentAtMs)}`,
        `text=${result.text}`,
    ].join("\n")
}
