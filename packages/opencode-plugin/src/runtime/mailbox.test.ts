import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost, BindingPreparedExecution, BindingPromptPart } from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayMailboxRuntime } from "./mailbox"

test("GatewayMailboxRuntime flushes queued entries one by one when batching is disabled", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const batches: number[][] = []
        const runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxEntries(entries) {
                    batches.push(entries.map((entry) => entry.id))
                    await Bun.sleep(5)
                    return {
                        conversationKey: entries[0].mailboxKey,
                        responseText: "ok",
                        delivered: true,
                        recordedAtMs: 1n,
                    }
                },
            },
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

        await runtime.enqueueInboundMessage(createMessage("first"), "telegram_update", "100")
        await runtime.enqueueInboundMessage(createMessage("second"), "telegram_update", "101")

        await waitFor(() => batches.length === 2 && store.listMailboxEntries("telegram:42").length === 0)

        expect(batches).toEqual([[1], [2]])
        expect(store.listMailboxEntries("telegram:42")).toEqual([])
    } finally {
        db.close()
    }
})

test("GatewayMailboxRuntime merges queued entries in the same mailbox when batching is enabled", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const batches: number[][] = []
        const runtime = new GatewayMailboxRuntime(
            {
                prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
                    return {
                        conversationKey: message.mailboxKey ?? `telegram:${message.deliveryTarget.target}`,
                        promptParts: createTextPromptParts(message.text ?? ""),
                        replyTarget: message.deliveryTarget,
                    }
                },
                async executeMailboxEntries(entries) {
                    batches.push(entries.map((entry) => entry.id))
                    return {
                        conversationKey: entries[0].mailboxKey,
                        responseText: "ok",
                        delivered: true,
                        recordedAtMs: 1n,
                    }
                },
            },
            store,
            new MemoryLogger(),
            {
                batchReplies: true,
                batchWindowMs: 30,
                routes: [],
            },
            {
                async tryHandleInboundMessage() {
                    return false
                },
            },
        )

        await runtime.enqueueInboundMessage(createMessage("first"), "telegram_update", "100")
        await runtime.enqueueInboundMessage(createMessage("second"), "telegram_update", "101")

        await waitFor(() => batches.length === 1)

        expect(batches).toEqual([[1, 2]])
        expect(store.listMailboxEntries("telegram:42")).toEqual([])
    } finally {
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

async function waitFor(predicate: () => boolean): Promise<void> {
    const startedAt = Date.now()

    while (!predicate()) {
        if (Date.now() - startedAt > 1_000) {
            throw new Error("timed out waiting for mailbox runtime")
        }

        await Bun.sleep(10)
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
