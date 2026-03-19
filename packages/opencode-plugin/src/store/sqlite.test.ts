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
        store.putTelegramUpdateOffset(99, 4242)
        store.appendJournal({
            kind: "cron_dispatch",
            recordedAtMs: 4242,
            conversationKey: "cron:nightly",
            payload: { id: "nightly" },
        })

        expect(store.getSessionBinding("cron:nightly")).toBe("session-1")
        expect(store.getTelegramUpdateOffset()).toBe(99)

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

test("sqlite migration upgrades a v1 database to include kv_state", () => {
    const db = new Database(":memory:")

    try {
        db.exec(`
            CREATE TABLE session_bindings (
                conversation_key TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE runtime_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                recorded_at_ms INTEGER NOT NULL,
                conversation_key TEXT,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX runtime_journal_kind_recorded_at_ms_idx
                ON runtime_journal (kind, recorded_at_ms);

            PRAGMA user_version = 1;
        `)

        migrateGatewayDatabase(db)

        const store = new SqliteStore(db)
        store.putTelegramUpdateOffset(7, 1234)

        expect(store.getTelegramUpdateOffset()).toBe(7)
    } finally {
        db.close()
    }
})
