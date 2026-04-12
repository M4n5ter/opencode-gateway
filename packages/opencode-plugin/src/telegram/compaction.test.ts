import { expect, test } from "bun:test"

import type { BindingDeliveryTarget, BindingLoggerHost, BindingLogLevel } from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayTelegramCompactionRuntime } from "./compaction"

const TELEGRAM_TARGET: BindingDeliveryTarget = {
    channel: "telegram",
    target: "42",
    topic: null,
}

test("GatewayTelegramCompactionRuntime applies the configured reaction to an existing session surface", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const calls: Array<{ chatId: string; messageId: number; emoji: string }> = []
        const runtime = new GatewayTelegramCompactionRuntime(
            {
                async setMessageReaction(chatId, messageId, emoji): Promise<void> {
                    calls.push({ chatId, messageId, emoji })
                },
            },
            createHierarchyClient(new Map()),
            "/workspace",
            store,
            {
                listReplyTargets(sessionId) {
                    return sessionId === "ses_root" ? [TELEGRAM_TARGET] : []
                },
            },
            new MemoryLogger(),
            createTelegramConfig(),
        )

        await runtime.registerSurface("ses_root", TELEGRAM_TARGET, 99)
        runtime.handleEvent({
            type: "session.compacted",
            properties: {
                sessionID: "ses_root",
            },
        })

        await waitFor(() => calls.length === 1)
        expect(calls).toEqual([{ chatId: "42", messageId: 99, emoji: "🗜️" }])
        expect(store.getTelegramSessionSurface("ses_root", TELEGRAM_TARGET)).toMatchObject({
            messageId: 99,
            reactionEmoji: "🗜️",
        })
    } finally {
        db.close()
    }
})

test("GatewayTelegramCompactionRuntime applies a deferred reaction when the surface is registered later", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const calls: Array<{ chatId: string; messageId: number; emoji: string }> = []
        const runtime = new GatewayTelegramCompactionRuntime(
            {
                async setMessageReaction(chatId, messageId, emoji): Promise<void> {
                    calls.push({ chatId, messageId, emoji })
                },
            },
            createHierarchyClient(new Map()),
            "/workspace",
            store,
            {
                listReplyTargets(sessionId) {
                    return sessionId === "ses_root" ? [TELEGRAM_TARGET] : []
                },
            },
            new MemoryLogger(),
            createTelegramConfig(),
        )

        runtime.handleEvent({
            type: "session.compacted",
            properties: {
                sessionID: "ses_root",
            },
        })

        await waitFor(() => store.getTelegramSessionCompaction("ses_root") !== null)
        await runtime.registerSurface("ses_root", TELEGRAM_TARGET, 100)

        await waitFor(() => calls.length === 1)
        expect(calls).toEqual([{ chatId: "42", messageId: 100, emoji: "🗜️" }])
    } finally {
        db.close()
    }
})

test("GatewayTelegramCompactionRuntime resolves child session compactions back to the ancestor session surface", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const calls: Array<{ chatId: string; messageId: number; emoji: string }> = []
        const runtime = new GatewayTelegramCompactionRuntime(
            {
                async setMessageReaction(chatId, messageId, emoji): Promise<void> {
                    calls.push({ chatId, messageId, emoji })
                },
            },
            createHierarchyClient(
                new Map([
                    ["ses_child", "ses_root"],
                    ["ses_root", null],
                ]),
            ),
            "/workspace",
            store,
            {
                listReplyTargets(sessionId) {
                    return sessionId === "ses_root" ? [TELEGRAM_TARGET] : []
                },
            },
            new MemoryLogger(),
            createTelegramConfig(),
        )

        await runtime.registerSurface("ses_root", TELEGRAM_TARGET, 77)
        runtime.handleEvent({
            type: "session.compacted",
            properties: {
                sessionID: "ses_child",
            },
        })

        await waitFor(() => calls.length === 1)
        expect(calls).toEqual([{ chatId: "42", messageId: 77, emoji: "🗜️" }])
        expect(store.getTelegramSessionCompaction("ses_root")).not.toBeNull()
        expect(store.getTelegramSessionCompaction("ses_child")).toBeNull()
    } finally {
        db.close()
    }
})

function createTelegramConfig() {
    return {
        enabled: true as const,
        botToken: "token",
        botTokenEnv: null,
        pollTimeoutSeconds: 25,
        allowedChats: ["42"],
        allowedUsers: [],
        allowedBotUsers: [],
        ux: {
            toolCallView: "toggle" as const,
            compactionReaction: true,
            compactionReactionEmoji: "🗜️",
        },
    }
}

function createHierarchyClient(parentIds: Map<string, string | null>) {
    return {
        session: {
            async get(input: { sessionID: string }): Promise<unknown> {
                return {
                    data: {
                        id: input.sessionID,
                        parentID: parentIds.get(input.sessionID) ?? undefined,
                    },
                }
            },
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    readonly messages: Array<{ level: BindingLogLevel; message: string }> = []

    log(level: BindingLogLevel, message: string): void {
        this.messages.push({ level, message })
    }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    const startedAt = Date.now()

    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error("timed out waiting for predicate")
        }

        await Bun.sleep(10)
    }
}
