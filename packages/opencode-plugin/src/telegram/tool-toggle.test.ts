import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramToolToggleRuntime } from "./tool-toggle"

test("TelegramToolToggleRuntime switches the preview message into tools view", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 77,
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
            processText: "Fetching data",
            reasoningText: null,
            answerText: "Done",
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
            recordedAtMs: 1,
        })

        const edits: Array<{ text: string; replyMarkup: unknown }> = []
        const answers: string[] = []
        const runtime = new TelegramToolToggleRuntime(
            {
                async answerCallbackQuery(_callbackQueryId, text) {
                    answers.push(text ?? "")
                },
                async editMessageText(_chatId, _messageId, text, options = {}) {
                    edits.push({
                        text,
                        replyMarkup: options.replyMarkup ?? null,
                    })
                },
            },
            store,
            "toggle",
        )

        await expect(
            runtime.handleTelegramCallbackQuery({
                callbackQueryId: "cb-1",
                sender: "telegram:42",
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                messageId: 77,
                data: "tv:tools",
            }),
        ).resolves.toBe(true)

        expect(edits).toEqual([
            {
                text: '<b>List repos</b> <i>running</i>\n<blockquote expandable>Input\n{"cmd":"gh repo list"}</blockquote>',
                replyMarkup: {
                    inline_keyboard: [
                        [
                            { text: "Preview", callback_data: "tv:preview" },
                            { text: "• Tools (1)", callback_data: "tv:tools" },
                        ],
                    ],
                },
            },
        ])
        expect(store.getTelegramPreviewMessage("42", 77)?.viewMode).toBe("tools")
        expect(answers).toEqual(["Showing tools"])
    } finally {
        db.close()
    }
})

test("TelegramToolToggleRuntime keeps tools paging interactive after completion", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 77,
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
            processText: "Fetching data",
            reasoningText: "Check cache",
            answerText: "Done",
            toolSections: Array.from({ length: 6 }, (_, index) => ({
                callId: `call-${index + 1}`,
                toolName: "bash",
                status: "completed" as const,
                title: `Step ${index + 1}`,
                inputText: "x".repeat(900),
                outputText: null,
                errorText: null,
            })),
            recordedAtMs: 1,
        })

        const edits: Array<{ text: string; replyMarkup: unknown }> = []
        const answers: string[] = []
        const runtime = new TelegramToolToggleRuntime(
            {
                async answerCallbackQuery(_callbackQueryId, text) {
                    answers.push(text ?? "")
                },
                async editMessageText(_chatId, _messageId, text, options = {}) {
                    edits.push({
                        text,
                        replyMarkup: options.replyMarkup ?? null,
                    })
                },
            },
            store,
            "toggle",
        )

        await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-1",
            sender: "telegram:42",
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            messageId: 77,
            data: "tv:tools",
        })
        await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-2",
            sender: "telegram:42",
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            messageId: 77,
            data: "tv:older",
        })
        await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-3",
            sender: "telegram:42",
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            messageId: 77,
            data: "tv:preview",
        })

        expect(edits[1]?.text).toContain("<b>Step 1</b>")
        expect(edits[2]).toEqual({
            text: "<blockquote expandable><i>Check cache</i></blockquote>\n\n<blockquote>Fetching data</blockquote>\n\nDone",
            replyMarkup: {
                inline_keyboard: [
                    [
                        { text: "• Preview", callback_data: "tv:preview" },
                        { text: "Tools (6)", callback_data: "tv:tools" },
                    ],
                ],
            },
        })
        expect(store.getTelegramPreviewMessage("42", 77)).toMatchObject({
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 1,
        })
        expect(answers).toEqual(["Showing tools", "Tools 2/2", "Showing preview"])
    } finally {
        db.close()
    }
})

test("TelegramToolToggleRuntime paginates long preview bodies without requiring tools", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 77,
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
            processText: "Working",
            reasoningText: null,
            answerText: ["alpha", "x".repeat(3500), "omega", "y".repeat(1200)].join("\n\n"),
            toolSections: [],
            recordedAtMs: 1,
        })

        const edits: Array<{ text: string; replyMarkup: unknown }> = []
        const answers: string[] = []
        const runtime = new TelegramToolToggleRuntime(
            {
                async answerCallbackQuery(_callbackQueryId, text) {
                    answers.push(text ?? "")
                },
                async editMessageText(_chatId, _messageId, text, options = {}) {
                    edits.push({
                        text,
                        replyMarkup: options.replyMarkup ?? null,
                    })
                },
            },
            store,
            "toggle",
        )

        await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-1",
            sender: "telegram:42",
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            messageId: 77,
            data: "tv:preview_next",
        })

        expect(edits[0]?.text).toContain("yyyy")
        expect(edits[0]?.replyMarkup).toEqual({
            inline_keyboard: [
                [
                    { text: "Prev", callback_data: "tv:preview_prev" },
                    { text: "2/2", callback_data: "tv:noop" },
                ],
            ],
        })
        expect(store.getTelegramPreviewMessage("42", 77)).toMatchObject({
            viewMode: "preview",
            previewPage: 1,
            toolsPage: 0,
        })
        expect(answers).toEqual(["Preview 2/2"])
    } finally {
        db.close()
    }
})
