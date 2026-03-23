import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost } from "../binding"
import { GatewaySessionContext } from "../session/context"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayQuestionRuntime } from "./runtime"

test("GatewayQuestionRuntime sends plain-text questions and replies from inbound text", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const sentBodies: string[] = []
        const replied: string[][][] = []
        sessions.replaceReplyTargets(
            "session-1",
            "telegram:42",
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            1,
        )

        const runtime = new GatewayQuestionRuntime(
            {
                question: {
                    async reply(input: { answers?: string[][] }) {
                        replied.push(input.answers ?? [])
                        return true as never
                    },
                    async reject() {
                        throw new Error("unexpected reject")
                    },
                },
            } as never,
            "/workspace",
            store,
            sessions,
            {
                async sendMessage(input) {
                    sentBodies.push(input.body)
                    return { errorMessage: null }
                },
            },
            null,
            new MemoryLogger(),
        )

        runtime.handleEvent({
            type: "question.asked",
            properties: {
                id: "question-1",
                sessionID: "session-1",
                questions: [
                    {
                        header: "Target",
                        question: "Where should the file go?",
                        options: [
                            {
                                label: "Telegram",
                                description: "Send to Telegram",
                            },
                        ],
                    },
                ],
            },
        })
        await Bun.sleep(0)

        expect(sentBodies).toHaveLength(1)
        expect(store.getPendingQuestionForTarget(createTarget("42"))?.requestId).toBe("question-1")

        const handled = await runtime.tryHandleInboundMessage(createInboundMessage("Telegram"))

        expect(handled).toBe(true)
        expect(replied).toEqual([[["Telegram"]]])
        expect(store.getPendingQuestionForTarget(createTarget("42"))).toBeNull()
    } finally {
        db.close()
    }
})

test("GatewayQuestionRuntime answers Telegram callback queries using native buttons", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const replied: string[][][] = []
        const callbackReplies: string[] = []

        sessions.replaceReplyTargets(
            "session-1",
            "telegram:42",
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            1,
        )

        const runtime = new GatewayQuestionRuntime(
            {
                question: {
                    async reply(input: { answers?: string[][] }) {
                        replied.push(input.answers ?? [])
                        return true as never
                    },
                    async reject() {
                        throw new Error("unexpected reject")
                    },
                },
            } as never,
            "/workspace",
            store,
            sessions,
            {
                async sendMessage() {
                    throw new Error("unexpected plain text send")
                },
            },
            {
                async sendInteractiveMessage() {
                    return {
                        message_id: 77,
                    }
                },
                async answerCallbackQuery(_callbackQueryId, text) {
                    callbackReplies.push(text ?? "")
                },
            },
            new MemoryLogger(),
        )

        runtime.handleEvent({
            type: "question.asked",
            properties: {
                id: "question-1",
                sessionID: "session-1",
                questions: [
                    {
                        header: "Target",
                        question: "Where should the file go?",
                        options: [
                            {
                                label: "Telegram",
                                description: "Send to Telegram",
                            },
                            {
                                label: "Other",
                                description: "Send elsewhere",
                            },
                        ],
                    },
                ],
            },
        })
        await Bun.sleep(0)

        expect(store.getPendingQuestionForTelegramMessage(createTarget("42"), 77)?.requestId).toBe("question-1")

        const handled = await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-1",
            sender: "telegram:7",
            deliveryTarget: createTarget("42"),
            messageId: 77,
            data: "q:0",
        })

        expect(handled).toBe(true)
        expect(replied).toEqual([[["Telegram"]]])
        expect(callbackReplies).toEqual(["Sent: Telegram"])
        expect(store.getPendingQuestionForTarget(createTarget("42"))).toBeNull()
    } finally {
        db.close()
    }
})

function createTarget(target: string) {
    return {
        channel: "telegram",
        target,
        topic: null,
    }
}

function createInboundMessage(text: string): BindingInboundMessage {
    return {
        deliveryTarget: createTarget("42"),
        sender: "telegram:7",
        text,
        attachments: [],
        mailboxKey: null,
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
