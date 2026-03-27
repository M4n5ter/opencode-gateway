import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramToolToggleRuntime } from "./tool-toggle"

test("TelegramToolToggleRuntime expands tool sections on callback", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 77,
            toolVisibility: "collapsed",
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
                data: "tv:show",
            }),
        ).resolves.toBe(true)

        expect(edits).toEqual([
            {
                text: '<blockquote>Fetching data</blockquote>\n\n<b>List repos</b> <i>running</i>\n<blockquote expandable>Input\n{"cmd":"gh repo list"}</blockquote>\n\nDone',
                replyMarkup: {
                    inline_keyboard: [[{ text: "Hide Tools", callback_data: "tv:hide" }]],
                },
            },
        ])
        expect(store.getTelegramPreviewMessage("42", 77)?.toolVisibility).toBe("expanded")
        expect(answers).toEqual(["Showing tools"])
    } finally {
        db.close()
    }
})
