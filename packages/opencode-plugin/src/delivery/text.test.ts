import { expect, test } from "bun:test"

import { GatewayTransportHost } from "../host/transport"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramProgressiveSupport } from "./telegram"
import { GatewayTextDelivery } from "./text"

test("GatewayTextDelivery uses draft preview for cached private chats", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            typing: 0,
            drafts: [] as string[],
            sends: [] as string[],
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.typing += 1
            },
            async sendMessage(_chatId: string, text: string): Promise<void> {
                calls.sends.push(text)
            },
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                calls.drafts.push(text)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
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
        await session.preview("hello")
        await session.finish("hello world")

        expect(calls.typing).toBe(1)
        expect(calls.drafts).toEqual(["hello", "hello world"])
        expect(calls.sends).toEqual(["hello world"])
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
            typing: 0,
            drafts: 0,
            sends: 0,
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
                calls.typing += 1
            },
            async sendMessage(): Promise<void> {
                calls.sends += 1
            },
            async sendMessageDraft(): Promise<void> {
                calls.drafts += 1
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
        expect(calls.typing).toBe(0)
        expect(calls.drafts).toBe(0)
        expect(calls.sends).toBe(1)
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
            async sendMessage(): Promise<void> {},
            async sendMessageDraft(): Promise<void> {},
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
        ).rejects.toThrow("telegram draft stream is only supported for private chats")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery records a draft fallback when Telegram draft preview fails", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            typing: 0,
            sends: [] as string[],
        }
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.typing += 1
            },
            async sendMessage(_chatId: string, text: string): Promise<void> {
                calls.sends.push(text)
            },
            async sendMessageDraft(): Promise<void> {
                throw new Error("draft failed")
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
                target: "42",
                topic: null,
            },
            "hello world",
            "auto",
        )

        expect(result.mode).toBe("progressive")
        expect(calls.typing).toBe(1)
        expect(calls.sends).toEqual(["hello world"])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("draft_send_failed")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery records preview_not_established when a progressive session finishes without previews", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const sends: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(_chatId: string, text: string): Promise<void> {
                sends.push(text)
            },
            async sendMessageDraft(): Promise<void> {
                throw new Error("unused")
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.finish("hello world")

        expect(sends).toEqual(["hello world"])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("preview_not_established")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery does not emit late drafts after finish starts", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        let releaseDraft!: () => void
        const draftReleased = new Promise<void>((resolve) => {
            releaseDraft = resolve
        })

        const calls: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.push("typing")
            },
            async sendMessage(_chatId: string, text: string): Promise<void> {
                calls.push(`send:${text}`)
            },
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                calls.push(`draft:${text}`)
                await draftReleased
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        const preview = session.preview("hello")
        await Promise.resolve()

        const finish = session.finish("hello world")
        await session.preview("hello world")
        releaseDraft()

        await preview
        await finish

        expect(calls).toEqual(["typing", "draft:hello", "draft:hello world", "send:hello world"])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery keeps drafts alive while a progressive reply remains open", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.push("typing")
            },
            async sendMessage(_chatId: string, text: string): Promise<void> {
                calls.push(`send:${text}`)
            },
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                calls.push(`draft:${text}`)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                progressiveRefreshIntervalMs: 10,
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

        await session.preview("working")
        await sleep(25)

        const keepaliveTypingCount = calls.filter((call) => call === "typing").length
        const keepaliveDraftCount = calls.filter((call) => call === "draft:working").length

        expect(keepaliveTypingCount).toBeGreaterThan(1)
        expect(keepaliveDraftCount).toBeGreaterThan(1)

        await session.finish("final answer")
        const callsAfterFinish = calls.length
        await sleep(25)

        expect(calls.at(-2)).toBe("draft:final answer")
        expect(calls.at(-1)).toBe("send:final answer")
        expect(calls.length).toBe(callsAfterFinish)
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery keeps typing alive before any preview text exists", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {
                calls.push("typing")
            },
            async sendMessage(_chatId: string, text: string): Promise<void> {
                calls.push(`send:${text}`)
            },
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                calls.push(`draft:${text}`)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                progressiveRefreshIntervalMs: 10,
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

        await sleep(25)

        expect(calls.filter((call) => call === "typing").length).toBeGreaterThan(1)
        expect(calls.filter((call) => call.startsWith("draft:"))).toHaveLength(0)

        await session.finish("final answer")
        const callsAfterFinish = calls.length
        await sleep(25)

        expect(calls).toContain("send:final answer")
        expect(calls.length).toBe(callsAfterFinish)
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery refreshes drafts with the latest preview text", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const drafts: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(): Promise<void> {},
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                drafts.push(text)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            {
                progressiveRefreshIntervalMs: 10,
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

        await session.preview("first")
        await sleep(12)
        await session.preview("second")
        await sleep(15)

        expect(drafts).toContain("first")
        expect(drafts).toContain("second")
        expect(drafts.at(-1)).toBe("second")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery skips whitespace-only draft previews", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const drafts: string[] = []
        const sends: string[] = []
        const client = {
            async getChat() {
                throw new Error("unused")
            },
            async sendChatAction(): Promise<void> {},
            async sendMessage(_chatId: string, text: string): Promise<void> {
                sends.push(text)
            },
            async sendMessageDraft(_chatId: string, _draftId: number, text: string): Promise<void> {
                drafts.push(text)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
        )

        const session = await delivery.open(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            "auto",
        )

        await session.preview("\n\n")
        await session.preview("hello")
        await session.finish("\n\nhello world")

        expect(drafts).toEqual(["hello", "hello world"])
        expect(sends).toEqual(["hello world"])
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
