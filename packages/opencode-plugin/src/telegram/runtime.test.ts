import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type { BindingLoggerHost } from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayTelegramRuntime } from "./runtime"
import type { TelegramBotProfile } from "./types"

test("telegram status returns disabled snapshot without probing when Telegram is off", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const runtime = new GatewayTelegramRuntime(null, store, new MemoryLogger(), { enabled: false }, null)

        const status = await runtime.status()

        expect(status.enabled).toBe(false)
        expect(status.liveProbe).toBe("disabled")
        expect(status.liveBotId).toBeNull()
    } finally {
        db.close()
    }
})

test("telegram status performs a live getMe probe and persists bot metadata", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const runtime = new GatewayTelegramRuntime(
            {
                async getMe(): Promise<TelegramBotProfile> {
                    return {
                        id: 42,
                        is_bot: true,
                        username: "gateway_bot",
                    }
                },
                async sendMessage(): Promise<void> {
                    throw new Error("unused")
                },
            },
            store,
            new MemoryLogger(),
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 25,
                allowedChats: ["-100123"],
                allowedUsers: ["7"],
            },
            null,
        )

        const status = await runtime.status()

        expect(status.enabled).toBe(true)
        expect(status.liveProbe).toBe("ok")
        expect(status.liveBotId).toBe("42")
        expect(status.liveBotUsername).toBe("gateway_bot")
        expect(store.getStateValue("telegram.last_bot_username")).toBe("gateway_bot")
    } finally {
        db.close()
    }
})

test("telegram sendTest uses explicit targets and records send health", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sent: { current: { chatId: string; text: string; topic: string | null } | null } = {
            current: null,
        }
        const runtime = new GatewayTelegramRuntime(
            {
                async getMe(): Promise<TelegramBotProfile> {
                    throw new Error("unused")
                },
                async sendMessage(chatId: string, text: string, topic: string | null): Promise<void> {
                    sent.current = { chatId, text, topic }
                },
            },
            store,
            new MemoryLogger(),
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 25,
                allowedChats: ["-100123"],
                allowedUsers: [],
            },
            null,
        )

        const result = await runtime.sendTest("-100123", "42", "hello test")

        expect(sent.current).toEqual({
            chatId: "-100123",
            text: "hello test",
            topic: "42",
        })
        expect(result.text).toBe("hello test")
        expect(store.getStateValue("telegram.last_send_success_ms")).not.toBeNull()
    } finally {
        db.close()
    }
})

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
