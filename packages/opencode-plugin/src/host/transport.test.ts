import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { buildTelegramStreamReplyMarkup, renderTelegramStreamMessageForView } from "../telegram/stream-render"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayTransportHost } from "./transport"

test("GatewayTransportHost resets deferred final preview edits back to the first preview page", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const calls = {
            edits: [] as Array<{ text: string; replyMarkup: unknown }>,
        }
        const client = {
            async sendMessage(): Promise<{ message_id: number }> {
                throw new Error("unused")
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

        const transport = new GatewayTransportHost(client, store, "toggle")
        const previewAnswer = ["alpha", "x".repeat(3300), "omega", "y".repeat(1000)].join("\n\n")
        const finalAnswer = ["alpha", "x".repeat(3500), "omega", "y".repeat(1200)].join("\n\n")

        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 99,
            viewMode: "preview",
            previewPage: 1,
            toolsPage: 0,
            processText: null,
            reasoningText: null,
            answerText: previewAnswer,
            toolSections: [],
            recordedAtMs: Date.now(),
        })

        await transport.deliverMessage(
            {
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                body: finalAnswer,
                previewContext: {
                    processText: null,
                    reasoningText: null,
                    answerText: previewAnswer,
                    toolSections: [],
                },
            },
            { mode: "edit", messageId: 99 },
        )

        expect(calls.edits).toEqual([
            {
                text: renderTelegramStreamMessageForView(
                    {
                        processText: null,
                        reasoningText: null,
                        answerText: finalAnswer,
                        toolSections: [],
                    },
                    {
                        toolCallView: "toggle",
                        viewState: {
                            viewMode: "preview",
                            previewPage: 0,
                            toolsPage: 0,
                        },
                    },
                ),
                replyMarkup: buildTelegramStreamReplyMarkup(
                    {
                        processText: null,
                        reasoningText: null,
                        answerText: finalAnswer,
                        toolSections: [],
                    },
                    {
                        toolCallView: "toggle",
                        viewState: {
                            viewMode: "preview",
                            previewPage: 0,
                            toolsPage: 0,
                        },
                    },
                ),
            },
        ])
        expect(store.getTelegramPreviewMessage("42", 99)).toMatchObject({
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
        })
    } finally {
        db.close()
    }
})

test("GatewayTransportHost registers the delivered Telegram surface for a session-scoped oneshot message", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const surfaces: Array<{ sessionId: string; target: string; messageId: number }> = []
        const client = {
            async sendMessage(): Promise<{ message_id: number }> {
                return { message_id: 123 }
            },
            async editMessageText(): Promise<void> {
                throw new Error("unused")
            },
        }
        const transport = new GatewayTransportHost(client, store, "toggle", {
            async registerSurface(sessionId, target, messageId): Promise<void> {
                surfaces.push({
                    sessionId,
                    target: target.target,
                    messageId,
                })
            },
        })

        await transport.sendMessage({
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            body: "final answer",
            sessionId: "ses_surface",
        })

        expect(surfaces).toEqual([
            {
                sessionId: "ses_surface",
                target: "42",
                messageId: 123,
            },
        ])
    } finally {
        db.close()
    }
})
