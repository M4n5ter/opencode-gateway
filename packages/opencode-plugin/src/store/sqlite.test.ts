import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "./migrations"
import { SqliteStore } from "./sqlite"

test("sqlite store persists session bindings and runtime journal entries", () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.putSessionBinding("cron:nightly", "session-1", 4242)
        store.appendJournal({
            kind: "cron_dispatch",
            recordedAtMs: 4242,
            conversationKey: "cron:nightly",
            payload: { id: "nightly" },
        })

        expect(store.getSessionBinding("cron:nightly")).toBe("session-1")

        const bindingRow = db
            .query<{ session_id: string; updated_at_ms: number }, [string]>(
                "SELECT session_id, updated_at_ms FROM session_bindings WHERE conversation_key = ?1;",
            )
            .get("cron:nightly")
        const journalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM runtime_journal;").get()

        expect(bindingRow).toEqual({
            session_id: "session-1",
            updated_at_ms: 4242,
        })
        expect(journalRow?.total).toBe(1)
    } finally {
        db.close()
    }
})
