import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramMessageCleanupRuntime } from "./cleanup"
import { TelegramApiError } from "./client"

test("TelegramMessageCleanupRuntime deletes due cleanup jobs", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.scheduleTelegramMessageCleanup("interaction", "42", 77, 0, 0)

        const deleted: Array<{ chatId: string; messageId: number }> = []
        const runtime = new TelegramMessageCleanupRuntime(
            {
                async deleteMessage(chatId, messageId) {
                    deleted.push({ chatId, messageId })
                },
            },
            store,
            createLogger(),
            {
                pollIntervalMs: 5,
                leaseMs: 20,
                retryDelayMs: 10,
                maxAttempts: 3,
            },
        )

        runtime.start()
        await Bun.sleep(20)
        runtime.stop()

        expect(deleted).toEqual([{ chatId: "42", messageId: 77 }])
        expect(store.listTelegramMessageCleanupJobs()).toEqual([])
    } finally {
        db.close()
    }
})

test("TelegramMessageCleanupRuntime treats missing Telegram messages as already cleaned up", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.scheduleTelegramMessageCleanup("interaction", "42", 77, 0, 0)

        const runtime = new TelegramMessageCleanupRuntime(
            {
                async deleteMessage() {
                    throw new TelegramApiError(
                        "Telegram deleteMessage failed (400): Bad Request: message to delete not found",
                        false,
                    )
                },
            },
            store,
            createLogger(),
            {
                pollIntervalMs: 5,
                leaseMs: 20,
                retryDelayMs: 10,
                maxAttempts: 3,
            },
        )

        runtime.start()
        await Bun.sleep(20)
        runtime.stop()

        expect(store.listTelegramMessageCleanupJobs()).toEqual([])
    } finally {
        db.close()
    }
})

function createLogger() {
    return {
        log() {},
    }
}
