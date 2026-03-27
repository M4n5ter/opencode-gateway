import { expect, test } from "bun:test"

import { createMemoryDatabase } from "../test/sqlite"
import { migrateGatewayDatabase } from "./migrations"
import { SqliteStore } from "./sqlite"

test("sqlite store persists session bindings, offsets, and cron catalog state", () => {
    const db = createMemoryDatabase()

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
            kind: "cron",
            schedule: "0 9 * * *",
            runAtMs: null,
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
            kind: "cron",
            schedule: "0 9 * * *",
            runAtMs: null,
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
        expect(store.listCronRuns("nightly", 5)).toEqual([
            {
                id: runId,
                jobId: "nightly",
                scheduledForMs: 9000,
                startedAtMs: 4242,
                finishedAtMs: 5252,
                status: "succeeded",
                responseText: "ok",
                errorMessage: null,
            },
        ])
    } finally {
        db.close()
    }
})

test("sqlite store deduplicates mailbox entries by source identity", () => {
    const db = createMemoryDatabase()

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
    const db = createMemoryDatabase()

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

test("sqlite store keeps an executing mailbox job leased after renewal", () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "300",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 100,
        })
        store.materializeMailboxJobs(100, false, 0)

        const claimed = store.claimNextMailboxJob(100, 200)
        expect(claimed?.id).toBe(1)
        expect(store.renewMailboxJobLease(1, 500, 150)).toBe(true)
        expect(store.requeueExpiredMailboxLeases(250)).toEqual({
            jobs: 0,
            deliveries: 0,
        })
        expect(store.getMailboxJob(1)?.status).toBe("executing")
        expect(store.getMailboxJob(1)?.leasedUntilMs).toBe(500)
    } finally {
        db.close()
    }
})

test("sqlite store downgrades edit-mode mailbox deliveries back to send without consuming an attempt", () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "301",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 100,
        })
        store.materializeMailboxJobs(100, false, 0)
        const job = store.claimNextMailboxJob(100, 200)
        expect(job?.id).toBe(1)

        store.completeMailboxJobExecution({
            jobId: 1,
            sessionId: "ses_1",
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
                        messageId: 77,
                    },
                    previewContext: null,
                },
            ],
            recordedAtMs: 150,
            deliveryRetryAtMs: 150,
        })

        const delivery = store.claimNextMailboxDelivery(150, 250)
        expect(delivery?.strategy).toEqual({
            mode: "edit",
            messageId: 77,
        })
        expect(delivery?.attemptCount).toBe(1)

        store.downgradeMailboxDeliveryToSend(1, "Telegram editMessageText failed (400): message to edit not found", 160)

        expect(store.getMailboxDelivery(1)).toEqual({
            id: 1,
            jobId: 1,
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            strategy: {
                mode: "send",
            },
            previewContext: null,
            status: "pending",
            attemptCount: 0,
            leasedUntilMs: null,
            nextAttemptAtMs: 160,
            lastError: "Telegram editMessageText failed (400): message to edit not found",
            createdAtMs: 150,
            updatedAtMs: 160,
            deliveredAtMs: null,
        })
    } finally {
        db.close()
    }
})

test("sqlite store schedules and retries Telegram message cleanup jobs", () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.scheduleTelegramMessageCleanup("interaction", "42", 77, 1_000, 900)
        store.scheduleTelegramMessageCleanup("interaction", "42", 77, 1_500, 950)

        expect(store.listTelegramMessageCleanupJobs()).toEqual([
            {
                id: 1,
                kind: "interaction",
                chatId: "42",
                messageId: 77,
                nextAttemptAtMs: 1_000,
                attemptCount: 0,
                leasedUntilMs: null,
                lastError: null,
                createdAtMs: 900,
                updatedAtMs: 950,
            },
        ])

        const claimed = store.claimNextTelegramMessageCleanup(1_000, 2_000)
        expect(claimed?.id).toBe(1)
        expect(claimed?.attemptCount).toBe(1)

        const dropped = store.recordTelegramMessageCleanupFailure(1, "timeout", 1_100, 2_100, 3)
        expect(dropped).toBe(false)
        expect(store.getTelegramMessageCleanup(1)).toEqual({
            id: 1,
            kind: "interaction",
            chatId: "42",
            messageId: 77,
            nextAttemptAtMs: 2_100,
            attemptCount: 1,
            leasedUntilMs: null,
            lastError: "timeout",
            createdAtMs: 900,
            updatedAtMs: 1_100,
        })

        expect(store.claimNextTelegramMessageCleanup(2_100, 3_100)?.attemptCount).toBe(2)
        expect(store.claimNextTelegramMessageCleanup(2_100, 3_100)).toBeNull()
        expect(store.recordTelegramMessageCleanupFailure(1, "timeout", 2_200, 3_200, 3)).toBe(false)
        expect(store.claimNextTelegramMessageCleanup(3_200, 4_200)?.attemptCount).toBe(3)
        expect(store.recordTelegramMessageCleanupFailure(1, "timeout", 3_300, 4_300, 3)).toBe(true)
        expect(store.getTelegramMessageCleanup(1)).toBeNull()
    } finally {
        db.close()
    }
})

test("sqlite store persists mailbox preview tool sections for deferred delivery", () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.enqueueMailboxEntry({
            mailboxKey: "telegram:42",
            sourceKind: "telegram_update",
            externalId: "302",
            sender: "telegram:7",
            text: "hello",
            attachments: [],
            replyChannel: "telegram",
            replyTarget: "42",
            replyTopic: null,
            recordedAtMs: 100,
        })
        store.materializeMailboxJobs(100, false, 0)
        expect(store.claimNextMailboxJob(100, 200)?.id).toBe(1)

        store.completeMailboxJobExecution({
            jobId: 1,
            sessionId: "ses_1",
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
                        messageId: 77,
                    },
                    previewContext: {
                        processText: "Working",
                        reasoningText: "Checking cache first",
                        toolSections: [
                            {
                                callId: "call-1",
                                toolName: "bash",
                                status: "completed",
                                title: "List repos",
                                inputText: '{"cmd":"gh repo list"}',
                                outputText: "repo-a\nrepo-b",
                                errorText: null,
                            },
                        ],
                    },
                },
            ],
            recordedAtMs: 150,
            deliveryRetryAtMs: 150,
        })

        expect(store.getMailboxDelivery(1)?.previewContext).toEqual({
            processText: "Working",
            reasoningText: "Checking cache first",
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "completed",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: "repo-a\nrepo-b",
                    errorText: null,
                },
            ],
        })
    } finally {
        db.close()
    }
})

test("sqlite store persists telegram preview messages and view state", () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        store.upsertTelegramPreviewMessage({
            chatId: "42",
            messageId: 77,
            viewMode: "preview",
            toolsPage: 0,
            processText: "Working",
            reasoningText: "Checking cache first",
            answerText: "Done",
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            recordedAtMs: 100,
        })

        expect(store.getTelegramPreviewMessage("42", 77)).toEqual({
            chatId: "42",
            messageId: 77,
            viewMode: "preview",
            toolsPage: 0,
            processText: "Working",
            reasoningText: "Checking cache first",
            answerText: "Done",
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: null,
                    errorText: null,
                },
            ],
            createdAtMs: 100,
            updatedAtMs: 100,
        })

        expect(store.setTelegramPreviewViewState("42", 77, "tools", 1, 150)).toMatchObject({
            viewMode: "tools",
            toolsPage: 1,
        })
        expect(store.getTelegramPreviewMessage("42", 77)?.updatedAtMs).toBe(150)

        store.deleteTelegramPreviewMessage("42", 77)
        expect(store.getTelegramPreviewMessage("42", 77)).toBeNull()
    } finally {
        db.close()
    }
})

test("sqlite store persists session reply targets and pending interactions", () => {
    const db = createMemoryDatabase()

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
        store.replacePendingInteraction({
            request: {
                kind: "question",
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
            },
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
        store.replacePendingInteraction({
            request: {
                kind: "permission",
                requestId: "permission-1",
                sessionId: "session-1",
                permission: "external_directory",
                patterns: ["/tmp/*"],
                metadata: {
                    path: "/tmp/demo.txt",
                },
                always: [],
                tool: null,
            },
            targets: [
                {
                    deliveryTarget: {
                        channel: "telegram",
                        target: "42",
                        topic: null,
                    },
                    telegramMessageId: 100,
                },
            ],
            recordedAtMs: 30,
        })

        expect(store.getDefaultSessionReplyTarget("session-1")).toEqual({
            channel: "telegram",
            target: "42",
            topic: null,
        })
        expect(
            store.getPendingInteractionForTarget({
                channel: "telegram",
                target: "42",
                topic: null,
            }),
        ).toEqual({
            kind: "question",
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
        expect(
            store.getPendingInteractionForTelegramMessage(
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
                100,
            ),
        ).toEqual({
            kind: "permission",
            requestId: "permission-1",
            sessionId: "session-1",
            permission: "external_directory",
            patterns: ["/tmp/*"],
            metadata: {
                path: "/tmp/demo.txt",
            },
            always: [],
            tool: null,
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            telegramMessageId: 100,
            createdAtMs: 30,
        })

        store.deletePendingInteraction("question-1")
        expect(
            store.getPendingInteractionForTarget({
                channel: "telegram",
                target: "42",
                topic: null,
            })?.requestId,
        ).toBe("permission-1")

        store.deletePendingInteractionsForSession("session-1")
        store.clearSessionReplyTargets("session-1")

        expect(store.getDefaultSessionReplyTarget("session-1")).toBeNull()
        expect(
            store.getPendingInteractionForTarget({
                channel: "telegram",
                target: "42",
                topic: null,
            }),
        ).toBeNull()
    } finally {
        db.close()
    }
})

test("sqlite migration upgrades pending questions to pending interactions", () => {
    const db = createMemoryDatabase()

    try {
        db.exec(`
            CREATE TABLE pending_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                delivery_channel TEXT NOT NULL,
                delivery_target TEXT NOT NULL,
                delivery_topic TEXT NOT NULL,
                question_json TEXT NOT NULL,
                telegram_message_id INTEGER,
                created_at_ms INTEGER NOT NULL
            );

            INSERT INTO pending_questions (
                request_id,
                session_id,
                delivery_channel,
                delivery_target,
                delivery_topic,
                question_json,
                telegram_message_id,
                created_at_ms
            )
            VALUES (
                'question-1',
                'session-1',
                'telegram',
                '42',
                '',
                '[{"header":"Confirm","question":"Continue?","options":[{"label":"Yes","description":"Continue"}],"multiple":false,"custom":false}]',
                77,
                10
            );

            PRAGMA user_version = 7;
        `)

        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        expect(
            store.getPendingInteractionForTarget({
                channel: "telegram",
                target: "42",
                topic: null,
            }),
        ).toEqual({
            kind: "question",
            requestId: "question-1",
            sessionId: "session-1",
            questions: [
                {
                    header: "Confirm",
                    question: "Continue?",
                    options: [
                        {
                            label: "Yes",
                            description: "Continue",
                        },
                    ],
                    multiple: false,
                    custom: false,
                },
            ],
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            telegramMessageId: 77,
            createdAtMs: 10,
        })
    } finally {
        db.close()
    }
})

test("sqlite migration upgrades a v3 database to include mailbox tables", () => {
    const db = createMemoryDatabase()

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
