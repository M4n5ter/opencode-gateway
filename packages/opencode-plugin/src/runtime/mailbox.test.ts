import { expect, test } from "bun:test"

import type {
    BindingDeferredDeliveryStrategy,
    BindingDeliveryTarget,
    BindingHostAck,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingOutboundMessage,
    BindingPreparedExecution,
    BindingPromptPart,
} from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import type { MailboxExecutionOutcome } from "./executor"
import { GatewayMailboxRuntime } from "./mailbox"

test("GatewayMailboxRuntime executes queued entries one by one when batching is disabled", async () => {
    const db = createMemoryDatabase()
    let runtime: GatewayMailboxRuntime | null = null

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const batches: number[][] = []
        runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxJob(job): Promise<MailboxExecutionOutcome> {
                    batches.push(job.entries.map((entry) => entry.id))
                    await Bun.sleep(5)
                    return createExecutionOutcome(job.mailboxKey, job.entries, [
                        {
                            channel: "telegram",
                            target: "42",
                            topic: null,
                        },
                    ])
                },
            },
            new MemoryTransport(),
            store,
            new MemoryLogger(),
            {
                batchReplies: false,
                batchWindowMs: 1_500,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        runtime.start()
        await runtime.enqueueInboundMessage(createMessage("first"), "telegram_update", "100")
        await runtime.enqueueInboundMessage(createMessage("second"), "telegram_update", "101")

        await waitFor(() => batches.length === 2 && store.listMailboxEntries("telegram:42").length === 0)

        expect(batches).toEqual([[1], [2]])
        expect(store.listMailboxEntries("telegram:42")).toEqual([])
        expect(store.listMailboxJobs().map((job) => job.status)).toEqual(["completed", "completed"])
    } finally {
        runtime?.stop()
        db.close()
    }
})

test("GatewayMailboxRuntime batches unassigned mailbox entries into one job when batching is enabled", async () => {
    const db = createMemoryDatabase()
    let runtime: GatewayMailboxRuntime | null = null

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const batches: number[][] = []
        runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxJob(job): Promise<MailboxExecutionOutcome> {
                    batches.push(job.entries.map((entry) => entry.id))
                    return createExecutionOutcome(job.mailboxKey, job.entries, [
                        {
                            channel: "telegram",
                            target: "42",
                            topic: null,
                        },
                    ])
                },
            },
            new MemoryTransport(),
            store,
            new MemoryLogger(),
            {
                batchReplies: true,
                batchWindowMs: 200,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        runtime.start()
        await runtime.enqueueInboundMessage(createMessage("first"), "telegram_update", "100")
        await runtime.enqueueInboundMessage(createMessage("second"), "telegram_update", "101")

        await waitFor(() => batches.length === 1 && store.listMailboxEntries("telegram:42").length === 0)

        expect(batches).toEqual([[1, 2]])
        expect(store.listMailboxEntries("telegram:42")).toEqual([])
        expect(store.listMailboxJobs().map((job) => job.status)).toEqual(["completed"])
    } finally {
        runtime?.stop()
        db.close()
    }
})

test("GatewayMailboxRuntime retries delivery without re-running execution", async () => {
    const db = createMemoryDatabase()
    let runtime: GatewayMailboxRuntime | null = null

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        let executionCalls = 0
        const transport = new MemoryTransport()
        runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxJob(job): Promise<MailboxExecutionOutcome> {
                    executionCalls += 1
                    return {
                        conversationKey: job.mailboxKey,
                        responseText: "ok",
                        finalText: "hello back",
                        deliveries: [
                            {
                                deliveryTarget: {
                                    channel: "telegram",
                                    target: "42",
                                    topic: null,
                                },
                                strategy: { mode: "send" },
                                previewContext: null,
                            },
                        ],
                        sessionId: "ses_retry",
                        recordedAtMs: Date.now(),
                    }
                },
            },
            transport,
            store,
            new MemoryLogger(),
            {
                batchReplies: false,
                batchWindowMs: 0,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        runtime.start()
        await runtime.enqueueInboundMessage(createMessage("retry me"), "telegram_update", "100")

        await waitFor(() => transport.messages.length === 1 && store.listMailboxEntries("telegram:42").length === 0)

        expect(executionCalls).toBe(1)
        expect(transport.messages).toEqual([
            {
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                body: "hello back",
                sessionId: "ses_retry",
                previewContext: null,
            },
        ])
        expect(store.listMailboxJobs().map((job) => job.status)).toEqual(["completed"])
        expect(store.listMailboxDeliveries(store.listMailboxJobs()[0].id).map((delivery) => delivery.status)).toEqual([
            "delivered",
        ])
    } finally {
        runtime?.stop()
        db.close()
    }
})

test("GatewayMailboxRuntime falls back from edit delivery to send when the stream message is no longer editable", async () => {
    const db = createMemoryDatabase()
    let runtime: GatewayMailboxRuntime | null = null

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        let executionCalls = 0
        const transport = new MemoryTransport([
            {
                kind: "permanent_edit_failure",
                errorMessage: "Telegram editMessageText failed (400): message to edit not found",
            },
            {
                kind: "delivered",
            },
        ])
        runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxJob(job): Promise<MailboxExecutionOutcome> {
                    executionCalls += 1
                    return {
                        conversationKey: job.mailboxKey,
                        responseText: "ok",
                        finalText: "hello back",
                        deliveries: [
                            {
                                deliveryTarget: {
                                    channel: "telegram",
                                    target: "42",
                                    topic: null,
                                },
                                strategy: {
                                    mode: "edit",
                                    messageId: 99,
                                },
                                previewContext: null,
                            },
                        ],
                        sessionId: "ses_fallback",
                        recordedAtMs: Date.now(),
                    }
                },
            },
            transport,
            store,
            new MemoryLogger(),
            {
                batchReplies: false,
                batchWindowMs: 0,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        runtime.start()
        await runtime.enqueueInboundMessage(createMessage("retry me"), "telegram_update", "100")

        await waitFor(() => store.listMailboxJobs()[0]?.status === "completed")

        expect(executionCalls).toBe(1)
        expect(transport.strategies).toEqual([{ mode: "edit", messageId: 99 }, { mode: "send" }])
        expect(transport.messages).toEqual([
            {
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                body: "hello back",
                sessionId: "ses_fallback",
                previewContext: null,
            },
            {
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                body: "hello back",
                sessionId: "ses_fallback",
                previewContext: null,
            },
        ])
        expect(store.listMailboxDeliveries(store.listMailboxJobs()[0].id).map((delivery) => delivery.status)).toEqual([
            "delivered",
        ])
    } finally {
        runtime?.stop()
        db.close()
    }
})

test("GatewayMailboxRuntime preserves deferred preview context for final delivery", async () => {
    const db = createMemoryDatabase()
    let runtime: GatewayMailboxRuntime | null = null

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const transport = new MemoryTransport()
        runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxJob(job): Promise<MailboxExecutionOutcome> {
                    return {
                        conversationKey: job.mailboxKey,
                        responseText: "ok",
                        finalText: "final answer",
                        deliveries: [
                            {
                                deliveryTarget: {
                                    channel: "telegram",
                                    target: "42",
                                    topic: null,
                                },
                                strategy: {
                                    mode: "edit",
                                    messageId: 99,
                                },
                                previewContext: {
                                    processText: "process block",
                                    reasoningText: "reasoning block",
                                },
                            },
                        ],
                        sessionId: "ses_preview",
                        recordedAtMs: Date.now(),
                    }
                },
            },
            transport,
            store,
            new MemoryLogger(),
            {
                batchReplies: false,
                batchWindowMs: 0,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        runtime.start()
        await runtime.enqueueInboundMessage(createMessage("preserve preview"), "telegram_update", "100")

        await waitFor(() => store.listMailboxJobs()[0]?.status === "completed")

        expect(transport.messages).toEqual([
            {
                deliveryTarget: {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                body: "final answer",
                sessionId: "ses_preview",
                previewContext: {
                    processText: "process block",
                    reasoningText: "reasoning block",
                    toolSections: [],
                },
            },
        ])
    } finally {
        runtime?.stop()
        db.close()
    }
})

function createMessage(text: string): BindingInboundMessage {
    return {
        sender: "telegram:7",
        text,
        attachments: [],
        deliveryTarget: {
            channel: "telegram",
            target: "42",
            topic: null,
        },
    }
}

function createTextPromptParts(text: string): BindingPromptPart[] {
    return [{ kind: "text", text }]
}

function createExecutionOutcome(
    conversationKey: string,
    entries: Array<{ id: number }>,
    replyTargets: BindingDeliveryTarget[],
): MailboxExecutionOutcome {
    return {
        conversationKey,
        responseText: "ok",
        finalText: "ok",
        deliveries: replyTargets.map((deliveryTarget) => ({
            deliveryTarget,
            strategy: { mode: "send" },
            previewContext: null,
        })),
        sessionId: `ses_${entries[0]?.id ?? 0}`,
        recordedAtMs: Date.now(),
    }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const startedAt = Date.now()

    while (!predicate()) {
        if (Date.now() - startedAt > 4_000) {
            throw new Error("timed out waiting for mailbox runtime")
        }

        await Bun.sleep(10)
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}

class MemoryTransport {
    readonly messages: BindingOutboundMessage[] = []
    readonly strategies: BindingDeferredDeliveryStrategy[] = []

    constructor(private readonly deliveryResults: BindingHostAck[] = []) {}

    async sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck> {
        this.messages.push(message)
        return {
            kind: "delivered",
        }
    }

    async deliverMessage(
        message: BindingOutboundMessage,
        strategy: BindingDeferredDeliveryStrategy = { mode: "send" },
    ): Promise<BindingHostAck> {
        this.messages.push(message)
        this.strategies.push(strategy)
        return this.deliveryResults.shift() ?? { kind: "delivered" }
    }
}
