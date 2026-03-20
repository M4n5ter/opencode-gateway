import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "./migrations"
import { SqliteStore } from "./sqlite"

test("sqlite store persists session bindings, offsets, and cron catalog state", () => {
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
        store.upsertCronJob({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: "telegram",
            deliveryTarget: "-100123",
            deliveryTopic: "42",
            enabled: true,
            nextRunAtMs: 9000,
            recordedAtMs: 4242,
        })

        expect(store.getSessionBinding("cron:nightly")).toBe("session-1")
        expect(store.getTelegramUpdateOffset()).toBe(99)
        expect(store.getCronJob("nightly")).toEqual({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: "telegram",
            deliveryTarget: "-100123",
            deliveryTopic: "42",
            enabled: true,
            nextRunAtMs: 9000,
            createdAtMs: 4242,
            updatedAtMs: 4242,
        })

        const runId = store.insertCronRun("nightly", 9000, 4242)
        store.finishCronRun(runId, "succeeded", 5252, "ok", null)

        const journalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM runtime_journal;").get()
        const runRow = db
            .query<{ status: string; response_text: string | null }, [number]>(
                "SELECT status, response_text FROM cron_runs WHERE id = ?1;",
            )
            .get(runId)

        expect(journalRow?.total).toBe(1)
        expect(runRow).toEqual({
            status: "succeeded",
            response_text: "ok",
        })
    } finally {
        db.close()
    }
})

test("sqlite migration upgrades a v2 database to include cron tables", () => {
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

            CREATE TABLE kv_state (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            PRAGMA user_version = 2;
        `)

        migrateGatewayDatabase(db)

        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: null,
            deliveryTarget: null,
            deliveryTopic: null,
            enabled: true,
            nextRunAtMs: 9000,
            recordedAtMs: 1234,
        })

        expect(store.listCronJobs()).toHaveLength(1)
    } finally {
        db.close()
    }
})
