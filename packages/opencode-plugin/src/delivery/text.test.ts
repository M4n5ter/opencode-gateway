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
                options?: { parseMode?: string; replyMarkup?: unknown },
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
                options?: { parseMode?: string; replyMarkup?: unknown },
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
            "toggle",
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
            reasoningText: null,
            answerText: "hello",
        })
        await sleep(20)
        await session.preview({
            processText: null,
            reasoningText: null,
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
                options?: { parseMode?: string; replyMarkup?: unknown },
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
            "toggle",
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
            reasoningText: null,
            answerText: "hello",
        })
        await session.finish("hello world")

        expect(sends).toEqual([
            {
                text: "hello world",
                parseMode: "HTML",
            },
        ])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("preview_not_established")
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery renders tool sections inside the Telegram preview message and keeps them in the final edit", async () => {
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<void> {
                calls.edits.push(text)
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "inline",
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
            reasoningText: null,
            answerText: null,
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
        })
        await sleep(10)
        await session.finish("final answer")

        expect(calls.sends).toEqual([
            '<blockquote>Let me fetch that for you:</blockquote>\n\n<b>List repos</b> <i>running</i>\n<blockquote expandable>Input\n{"cmd":"gh repo list"}</blockquote>',
        ])
        expect(calls.edits).toEqual([
            '<blockquote>Let me fetch that for you:</blockquote>\n\n<b>List repos</b> <i>running</i>\n<blockquote expandable>Input\n{"cmd":"gh repo list"}</blockquote>\n\nfinal answer',
        ])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery keeps preview content visible and moves tools behind a separate toggle view by default", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as Array<{ text: string; replyMarkup: unknown }>,
            edits: [] as Array<{ text: string; replyMarkup: unknown }>,
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
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
                return {
                    message_id: 9,
                }
            },
            async editMessageText(
                _chatId: string,
                _messageId: number,
                text: string,
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<void> {
                calls.edits.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "toggle",
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
            processText: "Running tools",
            reasoningText: null,
            answerText: null,
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            forceStreamOpen: true,
        })
        await sleep(10)
        await session.finish("final answer")

        expect(calls.sends).toEqual([
            {
                text: "<blockquote>Running tools</blockquote>",
                replyMarkup: {
                    inline_keyboard: [
                        [
                            { text: "• Preview", callback_data: "tv:preview" },
                            { text: "Tools (1)", callback_data: "tv:tools" },
                        ],
                    ],
                },
            },
        ])
        expect(calls.edits).toEqual([
            {
                text: "<blockquote>Running tools</blockquote>\n\nfinal answer",
                replyMarkup: {
                    inline_keyboard: [
                        [
                            { text: "• Preview", callback_data: "tv:preview" },
                            { text: "Tools (1)", callback_data: "tv:tools" },
                        ],
                    ],
                },
            },
        ])
        expect(store.getTelegramPreviewMessage("42", 9)).toMatchObject({
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
        })
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery opens the preview stream immediately when the first tool event arrives", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as string[],
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push(text)
                return {
                    message_id: 1,
                }
            },
            async editMessageText(): Promise<void> {},
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "toggle",
            {
                streamOpenDelayMs: 10_000,
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
            reasoningText: null,
            answerText: null,
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            forceStreamOpen: true,
        })
        await sleep(20)

        expect(calls.sends).toEqual(["<i>Tools: 1 running</i>"])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery updates the stream when only the tool toggle buttons change", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as Array<{ text: string; replyMarkup: unknown }>,
            edits: [] as Array<{ text: string; replyMarkup: unknown }>,
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
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
                return {
                    message_id: 15,
                }
            },
            async editMessageText(
                _chatId: string,
                _messageId: number,
                text: string,
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<void> {
                calls.edits.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "toggle",
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
            processText: "Running tools",
            reasoningText: null,
            answerText: null,
        })
        await sleep(10)
        await session.preview({
            processText: "Running tools",
            reasoningText: null,
            answerText: null,
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            forceStreamOpen: true,
        })
        await sleep(10)

        expect(calls.sends).toEqual([
            {
                text: "<blockquote>Running tools</blockquote>",
                replyMarkup: null,
            },
        ])
        expect(calls.edits).toEqual([
            {
                text: "<blockquote>Running tools</blockquote>",
                replyMarkup: {
                    inline_keyboard: [
                        [
                            { text: "• Preview", callback_data: "tv:preview" },
                            { text: "Tools (1)", callback_data: "tv:tools" },
                        ],
                    ],
                },
            },
        ])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery forces the final edit back to preview mode after tools were opened", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as Array<{ text: string; replyMarkup: unknown }>,
            edits: [] as Array<{ text: string; replyMarkup: unknown }>,
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
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
                return {
                    message_id: 12,
                }
            },
            async editMessageText(
                _chatId: string,
                _messageId: number,
                text: string,
                options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<void> {
                calls.edits.push({
                    text,
                    replyMarkup: options?.replyMarkup ?? null,
                })
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "toggle",
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
            processText: "Running tools",
            reasoningText: "Check memory first",
            answerText: null,
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            forceStreamOpen: true,
        })
        await sleep(10)

        store.setTelegramPreviewViewState("42", 12, "tools", 0, 0, Date.now())

        await session.finish("final answer")

        expect(calls.edits.at(-1)).toEqual({
            text: "<blockquote expandable><i>Check memory first</i></blockquote>\n\n<blockquote>Running tools</blockquote>\n\nfinal answer",
            replyMarkup: {
                inline_keyboard: [
                    [
                        { text: "• Preview", callback_data: "tv:preview" },
                        { text: "Tools (1)", callback_data: "tv:tools" },
                    ],
                ],
            },
        })
        expect(store.getTelegramPreviewMessage("42", 12)).toMatchObject({
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
        })
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
            "toggle",
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
            "toggle",
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
            sends: [] as string[],
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                if (calls.sends.length === 0) {
                    calls.sends.push(text)
                    throw new Error("stream open failed")
                }

                calls.sends.push(text)
                return {
                    message_id: calls.sends.length,
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
            "toggle",
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
            reasoningText: null,
            answerText: "hello",
        })
        await sleep(10)
        await session.finish("hello world")

        expect(calls.sends).toEqual(["hello", "hello world"])
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
            sends: [] as string[],
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push(text)
                return {
                    message_id: calls.sends.length + 4,
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
            "toggle",
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
            reasoningText: null,
            answerText: "hello",
        })
        await sleep(10)
        await session.finish("hello world")

        expect(calls.sends).toEqual(["hello", "hello world"])
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBe("stream_edit_failed")
    } finally {
        db.close()
    }
})

test("TelegramProgressiveSupport treats Telegram no-op stream edits as successful", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const logs: Array<{ level: string; message: string }> = []
        const client = {
            async editMessageText(
                _chatId: string,
                _messageId: number,
                _text: string,
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<void> {
                throw new Error(
                    "Telegram editMessageText failed (400): Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
                )
            },
        }
        const support = new TelegramProgressiveSupport(client, store, {
            log(level, message) {
                logs.push({ level, message })
            },
        })

        await expect(
            support.editStreamMessage(
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                5,
                "hello",
            ),
        ).resolves.toBeUndefined()

        expect(store.getStateValue("telegram.last_stream_error_message")).toBe("")
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBeNull()
        expect(logs).toEqual([])
    } finally {
        db.close()
    }
})

test("GatewayTextDelivery treats Telegram no-op final edits as successful delivery", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putStateValue("telegram.chat_type:42", "private", Date.now())

        const calls = {
            sends: [] as string[],
            edits: 0,
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
                _options?: { parseMode?: string; replyMarkup?: unknown },
            ): Promise<{ message_id: number }> {
                calls.sends.push(text)
                return {
                    message_id: 5,
                }
            },
            async editMessageText(): Promise<void> {
                calls.edits += 1
                throw new Error(
                    "Telegram editMessageText failed (400): Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
                )
            },
        }

        const delivery = new GatewayTextDelivery(
            new GatewayTransportHost(client, store),
            store,
            new TelegramProgressiveSupport(client, store, createLogger()),
            "toggle",
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
            reasoningText: null,
            answerText: "hello",
        })
        await sleep(10)
        await expect(session.finish("hello")).resolves.toBe(true)

        expect(calls.sends).toEqual(["hello"])
        expect(calls.edits).toBe(0)
        expect(store.getStateValue("telegram.last_stream_fallback_reason")).toBeNull()
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
