import { expect, test } from "bun:test"

import { GatewayTransportHost } from "../host/transport"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramProgressiveSupport } from "./telegram"
import { GatewayTextDelivery } from "./text"

test("GatewayTextDelivery opens a single editable Telegram message for slow private replies", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            typing: 0,
            sends: [] as Array<{ text: string; parseMode: string | null }>,
            edits: [] as Array<{ messageId: number; text: string; parseMode: string | null }>,
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.typing += 1
            },
            async sendMessage(
                _chatId: string,
                text: string,
                _topic?: string | null,
                options?: { parseMode?: string },
            ): Promise<{ message_id: number }> {
                calls.sends.push({
                    text,
                    parseMode: options?.parseMode ?? null,
                })
                return {
                    message_id: calls.sends.length,
                }
            },
            async editMessageText(
                _chatId: string,
                messageId: number,
                text: string,
                options?: { parseMode?: string },
            ): Promise<void> {
                calls.edits.push({
                    messageId,
                    text,
                    parseMode: options?.parseMode ?? null,
                })
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                streamOpenDelayMs: 10,
                streamEditIntervalMs: 10,
                typingKeepaliveIntervalMs: 10,
            },
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        expect(session.mode).toBe("progressive")
        await session.preview({
            processText: null,
            answerText: "hello",
        })
        await sleep(20)
        await session.preview({
            processText: null,
            answerText: "hello world",
        })
        await sleep(20)
        await session.finish("hello world!")

        expect(calls.typing).toBeGreaterThanOrEqual(1)
        expect(calls.sends).toEqual([
            {
                text: "hello",
                parseMode: "HTML",
            },
        ])
        expect(calls.edits).toEqual([
            {
                messageId: 1,
                text: "hello world",
                parseMode: "HTML",
            },
            {
                messageId: 1,
                text: "hello world!",
                parseMode: "HTML",
            },
        ])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery keeps fast private replies in oneshot mode before the stream window opens", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const sends: Array<{ text: string; parseMode: string | null }> = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(
                _chatId: string,
                text: string,
                _topic?: string | null,
                options?: { parseMode?: string },
            ): Promise<{ message_id: number }> {
                sends.push({
                    text,
                    parseMode: options?.parseMode ?? null,
                })
                return {
                    message_id: 1,
                }
            },
            async editMessageText(): Promise<void> {
                throw new Error("unused")
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                streamOpenDelayMs: 50,
                streamEditIntervalMs: 10,
                typingKeepaliveIntervalMs: 10,
            },
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.preview({
            processText: null,
            answerText: "hello",
        })
        await session.finish("hello world")

        expect(sends).toEqual([
            {
                text: "hello world",
                parseMode: null,
            },
        ])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("preview_not_established")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery renders tool progress in a Telegram blockquote above the final answer", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as string[],
            edits: [] as string[],
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(
                _chatId: string,
                text: string,
                _topic?: string | null,
                _options?: { parseMode?: string },
            ): Promise<{ message_id: number }> {
                calls.sends.push(text)
                return {
                    message_id: 7,
                }
            },
            async editMessageText(
                _chatId: string,
                _messageId: number,
                text: string,
                _options?: { parseMode?: string },
            ): Promise<void> {
                calls.edits.push(text)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                streamOpenDelayMs: 0,
                streamEditIntervalMs: 10,
                typingKeepaliveIntervalMs: 10,
            },
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.preview({
            processText: "Let me fetch that for you:",
            answerText: null,
        })
        await sleep(10)
        await session.finish("final answer")

        expect(calls.sends).toEqual(["<blockquote>Let me fetch that for you:</blockquote>"])
        expect(calls.edits).toEqual(["<blockquote>Let me fetch that for you:</blockquote>\n\nfinal answer"])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery falls back to oneshot for non-private Telegram chats", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        const calls = {
            getChat: 0,
            sends: 0,
            edits: 0,
        }
        const client = {
            async getChat() {
                calls.getChat += 1
                return {
                    id: -100123,
                    type: "supergroup",
                }
            },
            async sendChatAction(): Promise<void> {
                throw new Error("unused")
            },
            async sendMessage(): Promise<{ message_id: number }> {
                calls.sends += 1
                return {
                    message_id: calls.sends,
                }
            },
            async editMessageText(): Promise<void> {
                calls.edits += 1
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
        )

        const result = await delivery.sendTest(
            {
                channel: "telegram",
                target: "-100123",
                topic: null,
            },
            "hello world",
            "auto",
        )

        expect(result.mode).toBe("oneshot")
        expect(calls.getChat).toBe(1)
        expect(calls.sends).toBe(1)
        expect(calls.edits).toBe(0)
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("non_private_chat")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery rejects forced stream mode for non-private chats", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const client = {
            async getChat() {
                return {
                    id: -100123,
                    type: "supergroup",
                }
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(): Promise<{ message_id: number }> {
                throw new Error("unused")
            },
            async editMessageText(): Promise<void> {
                throw new Error("unused")
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
        )

        await expect(
            delivery.sendTest(
                {
                    channel: "telegram",
                    target: "-100123",
                    topic: null,
                },
                "hello world",
                "stream",
            ),
        ).rejects.toThrow("telegram streaming is only supported for private chats")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery falls back to oneshot when opening the stream message fails", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            plainSends: [] as string[],
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(
                _chatId: string,
                text: string,
                _topic?: string | null,
                options?: { parseMode?: string },
            ): Promise<{ message_id: number }> {
                if (options?.parseMode === "HTML") {
                    throw new Error("stream open failed")
                }

                calls.plainSends.push(text)
                return {
                    message_id: 1,
                }
            },
            async editMessageText(): Promise<void> {
                throw new Error("unused")
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                streamOpenDelayMs: 0,
                streamEditIntervalMs: 10,
                typingKeepaliveIntervalMs: 10,
            },
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.preview({
            processText: null,
            answerText: "hello",
        })
        await sleep(10)
        await session.finish("hello world")

        expect(calls.plainSends).toEqual(["hello world"])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("stream_send_failed")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery falls back to oneshot when the final stream edit fails", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            plainSends: [] as string[],
            streamSends: 0,
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(
                _chatId: string,
                text: string,
                _topic?: string | null,
                options?: { parseMode?: string },
            ): Promise<{ message_id: number }> {
                if (options?.parseMode === "HTML") {
                    calls.streamSends += 1
                    return {
                        message_id: 5,
                    }
                }

                calls.plainSends.push(text)
                return {
                    message_id: 6,
                }
            },
            async editMessageText(): Promise<void> {
                throw new Error("stream edit failed")
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                streamOpenDelayMs: 0,
                streamEditIntervalMs: 10,
                typingKeepaliveIntervalMs: 10,
            },
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.preview({
            processText: null,
            answerText: "hello",
        })
        await sleep(10)
        await session.finish("hello world")

        expect(calls.streamSends).toBe(1)
        expect(calls.plainSends).toEqual(["hello world"])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("stream_edit_failed")
    } finally {
        db.close()
    }
})

function createLogger() {
    return {
        log() {},
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}
