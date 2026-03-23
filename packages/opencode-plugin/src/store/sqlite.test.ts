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
        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "100",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 4242,
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
        expect(store.listPendingMailboxKeys()).toEqual(["telegram:42"])
        expect(store.listMailboxEntries("telegram:42")).toEqual([
            {
                id: 1,
                mailboxKey: "telegram:42",
                sourceKind: "telegram_update",
                externalId: "100",
                sender: "telegram:7",
                text: "hello",
                attachments: [],
                replyChannel: "telegram",
                replyTarget: "42",
                replyTopic: null,
                createdAtMs: 4242,
            },
        ])
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

test("sqlite store deduplicates mailbox entries by source identity", () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "100",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 1,
        })
        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "100",
            sender: "telegram:7",
            text: "hello again",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 2,
        })

        expect(store.listMailboxEntries("telegram:42")).toHaveLength(1)
    } finally {
        db.close()
    }
})

test("sqlite store persists mailbox entry attachments alongside text", () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "200",
            sender: "telegram:7",
            text: null,
            attachments: [
                {
                    kind: "image",
                    mimeType: "image/png",
                    fileName: "photo.png",
                    localPath: "/tmp/photo.png",
                },
            ],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 1,
        })

        expect(store.listMailboxEntries("telegram:42")).toEqual([
            {
                id: 1,
                mailboxKey: "telegram:42",
                sourceKind: "telegram_update",
                externalId: "200",
                sender: "telegram:7",
                text: null,
                attachments: [
                    {
                        kind: "image",
                        ordinal: 0,
                        mimeType: "image/png",
                        fileName: "photo.png",
                        localPath: "/tmp/photo.png",
                    },
                ],
                replyChannel: "telegram",
                replyTarget: "42",
                replyTopic: null,
                createdAtMs: 1,
            },
        ])
    } finally {
        db.close()
    }
})

test("sqlite store persists session reply targets and pending questions", () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.replaceSessionReplyTargets({
            sessionId: "session-1",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 10,
        })
        store.replacePendingQuestion({
            requestId: "question-1",
            sessionId: "session-1",
            questions: [
                {
                    header: "Target",
                    question: "Where should the file go?",
                    options: [
                        {
                            label: "Telegram",
                            description: "Send it to Telegram",
                        },
                    ],
                    multiple: false,
                    custom: true,
                },
            ],
            targets: [
                {
                    deliveryTarget: {
                        channel: "telegram",
                        target: "42",
                        topic: null,
                    },
                    telegramMessageId: 99,
                },
            ],
            recordedAtMs: 20,
        })

        expect(store.getDefaultSessionReplyTarget("session-1")).toEqual({
            channel: "telegram",
            target: "42",
            topic: null,
        })
        expect(
            store.getPendingQuestionForTarget({
                channel: "telegram",
                target: "42",
                topic: null,
            }),
        ).toEqual({
            requestId: "question-1",
            sessionId: "session-1",
            questions: [
                {
                    header: "Target",
                    question: "Where should the file go?",
                    options: [
                        {
                            label: "Telegram",
                            description: "Send it to Telegram",
                        },
                    ],
                    multiple: false,
                    custom: true,
                },
            ],
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            telegramMessageId: 99,
            createdAtMs: 20,
        })
    } finally {
        db.close()
    }
})

test("sqlite migration upgrades a v3 database to include mailbox tables", () => {
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

            CREATE TABLE cron_jobs (
                id TEXT PRIMARY KEY NOT NULL,
                schedule TEXT NOT NULL,
                prompt TEXT NOT NULL,
                delivery_channel TEXT,
                delivery_target TEXT,
                delivery_topic TEXT,
                enabled INTEGER NOT NULL,
                next_run_at_ms INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX cron_jobs_enabled_next_run_at_ms_idx
                ON cron_jobs (enabled, next_run_at_ms);

            CREATE TABLE cron_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                scheduled_for_ms INTEGER NOT NULL,
                started_at_ms INTEGER NOT NULL,
                finished_at_ms INTEGER,
                status TEXT NOT NULL,
                response_text TEXT,
                error_message TEXT
            );

            CREATE INDEX cron_runs_job_id_started_at_ms_idx
                ON cron_runs (job_id, started_at_ms DESC);

            CREATE INDEX cron_runs_status_started_at_ms_idx
                ON cron_runs (status, started_at_ms DESC);

            PRAGMA user_version = 3;
        `)

        migrateGatewayDatabase(db)

        const store = new SqliteStore(db)
        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "100",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 1234,
        })

        expect(store.listPendingMailboxKeys()).toEqual(["telegram:42"])
    } finally {
        db.close()
    }
})
