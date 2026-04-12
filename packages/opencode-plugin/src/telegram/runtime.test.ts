import { expect, test } from "bun:test"

import type { BindingLoggerHost } from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayTelegramRuntime } from "./runtime"
import type { TelegramBotProfile } from "./types"

test("telegram status performs a live getMe probe and persists bot metadata", async () => {
    const db = createMemoryDatabase()

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
                async sendMessage(): Promise<{ message_id: number }> {
                    throw new Error("unused")
                },
                async editMessageText(): Promise<void> {
                    throw new Error("unused")
                },
                async sendChatAction(): Promise<void> {
                    throw new Error("unused")
                },
                async getChat() {
                    throw new Error("unused")
                },
                async getFile() {
                    throw new Error("unused")
                },
                async downloadFile() {
                    throw new Error("unused")
                },
                async sendPhoto() {
                    throw new Error("unused")
                },
                async sendDocument() {
                    throw new Error("unused")
                },
            },
            {
                async sendTest() {
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
                allowedBotUsers: [],
            },
            null,
            createEventStream(),
        )

        const status = await runtime.status()

        expect(status.enabled).toBe(true)
        expect(status.pollState).toBe("idle")
        expect(status.liveProbe).toBe("ok")
        expect(status.liveBotId).toBe("42")
        expect(status.liveBotUsername).toBe("gateway_bot")
        expect(status.opencodeEventStreamConnected).toBe(true)
        expect(status.lastEventStreamError).toBeNull()
        expect(store.getStateValue("telegram.last_bot_username")).toBe("gateway_bot")
    } finally {
        db.close()
    }
})

test("telegram sendTest uses explicit targets and records send health", async () => {
    const db = createMemoryDatabase()

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
                async sendMessage(): Promise<{ message_id: number }> {
                    throw new Error("unused")
                },
                async editMessageText(): Promise<void> {
                    throw new Error("unused")
                },
                async sendChatAction(): Promise<void> {
                    throw new Error("unused")
                },
                async getChat() {
                    throw new Error("unused")
                },
                async getFile() {
                    throw new Error("unused")
                },
                async downloadFile() {
                    throw new Error("unused")
                },
                async sendPhoto() {
                    throw new Error("unused")
                },
                async sendDocument() {
                    throw new Error("unused")
                },
            },
            {
                async sendTest(target, text) {
                    sent.current = {
                        chatId: target.target,
                        text,
                        topic: target.topic,
                    }

                    return {
                        delivered: true,
                        mode: "oneshot" as const,
                    }
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
                allowedBotUsers: [],
            },
            null,
            createEventStream(),
        )

        const result = await runtime.sendTest("-100123", "42", "hello test", "auto")

        expect(sent.current).toEqual({
            chatId: "-100123",
            text: "hello test",
            topic: "42",
        })
        expect(result.text).toBe("hello test")
        expect(result.mode).toBe("oneshot")
    } finally {
        db.close()
    }
})

test("telegram status reports stalled polling when the current poll exceeds the timeout budget", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const now = Date.now()
        store.putStateValue("telegram.last_poll_started_ms", String(now - 31_000), now)
        const runtime = new GatewayTelegramRuntime(
            {
                async getMe(): Promise<TelegramBotProfile> {
                    return {
                        id: 42,
                        is_bot: true,
                        username: "gateway_bot",
                    }
                },
                async sendMessage(): Promise<{ message_id: number }> {
                    throw new Error("unused")
                },
                async editMessageText(): Promise<void> {
                    throw new Error("unused")
                },
                async sendChatAction(): Promise<void> {
                    throw new Error("unused")
                },
                async getChat() {
                    throw new Error("unused")
                },
                async getFile() {
                    throw new Error("unused")
                },
                async downloadFile() {
                    throw new Error("unused")
                },
                async sendPhoto() {
                    throw new Error("unused")
                },
                async sendDocument() {
                    throw new Error("unused")
                },
            },
            {
                async sendTest() {
                    throw new Error("unused")
                },
            },
            store,
            new MemoryLogger(),
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 15,
                allowedChats: ["-100123"],
                allowedUsers: ["7"],
                allowedBotUsers: [],
            },
            {
                isRunning() {
                    return true
                },
                currentPollStartedAtMs() {
                    return now - 31_000
                },
                requestTimeoutMs() {
                    return 25_000
                },
                recoveryRecordedAtMs() {
                    return null
                },
                start() {},
            },
            createEventStream(),
        )

        const status = await runtime.status()

        expect(status.pollState).toBe("stalled")
    } finally {
        db.close()
    }
})

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}

function createEventStream() {
    return {
        isConnected() {
            return true
        },
        lastStreamError() {
            return null
        },
    }
}
