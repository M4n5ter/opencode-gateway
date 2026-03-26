import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost } from "../binding"
import { GatewaySessionContext } from "../session/context"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayInteractionRuntime } from "./runtime"
import type { GatewayPermissionReply } from "./types"

test("GatewayInteractionRuntime sends plain-text questions and replies from inbound text", async () => {
    const db = createMemoryDatabase()

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

        const runtime = new GatewayInteractionRuntime(
            {
                permission: {
                    async reply() {
                        throw new Error("unexpected permission reply")
                    },
                },
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
        expect(store.getPendingInteractionForTarget(createTarget("42"))?.requestId).toBe("question-1")

        const handled = await runtime.tryHandleInboundMessage(createInboundMessage("Telegram"))

        expect(handled).toBe(true)
        expect(replied).toEqual([[["Telegram"]]])
        expect(store.getPendingInteractionForTarget(createTarget("42"))).toBeNull()
    } finally {
        db.close()
    }
})

test("GatewayInteractionRuntime answers Telegram callback queries for single-choice questions", async () => {
    const db = createMemoryDatabase()

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

        const runtime = new GatewayInteractionRuntime(
            {
                permission: {
                    async reply() {
                        throw new Error("unexpected permission reply")
                    },
                },
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

        expect(store.getPendingInteractionForTelegramMessage(createTarget("42"), 77)?.requestId).toBe("question-1")

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
        expect(store.getPendingInteractionForTarget(createTarget("42"))).toBeNull()
    } finally {
        db.close()
    }
})

test("GatewayInteractionRuntime sends permission requests with HTML Telegram controls and handles callback replies", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const permissionReplies: GatewayPermissionReply[] = []
        const callbackReplies: string[] = []
        const interactiveMessages: Array<{
            text: string
            options: { parseMode?: string }
            replyMarkup: unknown
        }> = []

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

        const runtime = new GatewayInteractionRuntime(
            {
                permission: {
                    async reply(input: { reply?: GatewayPermissionReply }) {
                        permissionReplies.push(input.reply ?? "reject")
                        return true as never
                    },
                },
                question: {
                    async reply() {
                        throw new Error("unexpected question reply")
                    },
                    async reject() {
                        throw new Error("unexpected question reject")
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
                async sendInteractiveMessage(_chatId, text, _threadId, replyMarkup, options = {}) {
                    interactiveMessages.push({
                        text,
                        options,
                        replyMarkup,
                    })
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
            type: "permission.asked",
            properties: {
                id: "permission-1",
                sessionID: "session-1",
                permission: "external_directory",
                patterns: ["/tmp/*"],
                metadata: {
                    path: "/tmp/demo.txt",
                    command: "cat /tmp/demo.txt",
                },
                always: ["/tmp/*"],
                tool: {
                    messageID: "msg-1",
                    callID: "call-1",
                },
            },
        })
        await Bun.sleep(0)

        expect(interactiveMessages).toHaveLength(1)
        expect(interactiveMessages[0]?.options.parseMode).toBe("HTML")
        expect(interactiveMessages[0]?.text).toContain("<b>OpenCode needs approval before it can continue.</b>")
        expect(store.getPendingInteractionForTelegramMessage(createTarget("42"), 77)?.kind).toBe("permission")

        const handled = await runtime.handleTelegramCallbackQuery({
            callbackQueryId: "cb-1",
            sender: "telegram:7",
            deliveryTarget: createTarget("42"),
            messageId: 77,
            data: "p:always",
        })

        expect(handled).toBe(true)
        expect(permissionReplies).toEqual(["always"])
        expect(callbackReplies).toEqual(["Approved for this OpenCode session."])
        expect(store.getPendingInteractionForTarget(createTarget("42"))).toBeNull()
    } finally {
        db.close()
    }
})

test("GatewayInteractionRuntime handles plain-text permission replies and rejects unavailable always replies", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const sentBodies: string[] = []
        const permissionReplies: GatewayPermissionReply[] = []

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

        const runtime = new GatewayInteractionRuntime(
            {
                permission: {
                    async reply(input: { reply?: GatewayPermissionReply }) {
                        permissionReplies.push(input.reply ?? "reject")
                        return true as never
                    },
                },
                question: {
                    async reply() {
                        throw new Error("unexpected question reply")
                    },
                    async reject() {
                        throw new Error("unexpected question reject")
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
            type: "permission.asked",
            properties: {
                id: "permission-1",
                sessionID: "session-1",
                permission: "external_directory",
                patterns: ["/tmp/*"],
                metadata: {
                    path: "/tmp/demo.txt",
                },
                always: [],
            },
        })
        await Bun.sleep(0)

        expect(sentBodies[0]).toContain("Reply /once to approve this request.")

        const invalidHandled = await runtime.tryHandleInboundMessage(createInboundMessage("/always"))
        expect(invalidHandled).toBe(true)
        expect(sentBodies.at(-1)).toContain('does not offer an "always" approval option')
        expect(permissionReplies).toEqual([])

        const acceptedHandled = await runtime.tryHandleInboundMessage(createInboundMessage("/once"))
        expect(acceptedHandled).toBe(true)
        expect(permissionReplies).toEqual(["once"])
        expect(store.getPendingInteractionForTarget(createTarget("42"))).toBeNull()
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
