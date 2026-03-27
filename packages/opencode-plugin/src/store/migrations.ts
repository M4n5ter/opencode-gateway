import type { SqliteDatabaseLike } from "./database"

const LATEST_SCHEMA_VERSION = 16

export function migrateGatewayDatabase(db: SqliteDatabaseLike): void {
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA foreign_keys = ON;")

    let currentVersion = readUserVersion(db)
    if (currentVersion > LATEST_SCHEMA_VERSION) {
        throw new Error(`unsupported gateway database schema version: ${currentVersion}`)
    }

    if (currentVersion === 0) {
        migrateToV1(db)
        currentVersion = 1
    }

    if (currentVersion === 1) {
        migrateToV2(db)
        currentVersion = 2
    }

    if (currentVersion === 2) {
        migrateToV3(db)
        currentVersion = 3
    }

    if (currentVersion === 3) {
        migrateToV4(db)
        currentVersion = 4
    }

    if (currentVersion === 4) {
        migrateToV5(db)
        currentVersion = 5
    }

    if (currentVersion === 5) {
        migrateToV6(db)
        currentVersion = 6
    }

    if (currentVersion === 6) {
        migrateToV7(db)
        currentVersion = 7
    }

    if (currentVersion === 7) {
        migrateToV8(db)
        currentVersion = 8
    }

    if (currentVersion === 8) {
        migrateToV9(db)
        currentVersion = 9
    }

    if (currentVersion === 9) {
        migrateToV10(db)
        currentVersion = 10
    }

    if (currentVersion === 10) {
        migrateToV11(db)
        currentVersion = 11
    }

    if (currentVersion === 11) {
        migrateToV12(db)
        currentVersion = 12
    }

    if (currentVersion === 12) {
        migrateToV13(db)
        currentVersion = 13
    }

    if (currentVersion === 13) {
        migrateToV14(db)
        currentVersion = 14
    }

    if (currentVersion === 14) {
        migrateToV15(db)
        currentVersion = 15
    }

    if (currentVersion === 15) {
        migrateToV16(db)
    }
}

function readUserVersion(db: SqliteDatabaseLike): number {
    const row = db.query<{ user_version: number }, []>("PRAGMA user_version;").get()
    return row?.user_version ?? 0
}

function migrateToV1(db: SqliteDatabaseLike): void {
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
    `)
    db.exec("PRAGMA user_version = 1;")
}

function migrateToV2(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE kv_state (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
    `)
    db.exec("PRAGMA user_version = 2;")
}

function migrateToV3(db: SqliteDatabaseLike): void {
    db.exec(`
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
    `)
    db.exec("PRAGMA user_version = 3;")
}

function migrateToV4(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE mailbox_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            external_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            body TEXT NOT NULL,
            reply_channel TEXT,
            reply_target TEXT,
            reply_topic TEXT,
            created_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX mailbox_entries_source_kind_external_id_idx
            ON mailbox_entries (source_kind, external_id);

        CREATE INDEX mailbox_entries_mailbox_key_id_idx
            ON mailbox_entries (mailbox_key, id);
    `)
    db.exec("PRAGMA user_version = 4;")
}

function migrateToV5(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE mailbox_entry_attachments (
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_name TEXT,
            local_path TEXT NOT NULL,
            PRIMARY KEY (mailbox_entry_id, ordinal)
        );

        CREATE INDEX mailbox_entry_attachments_entry_id_ordinal_idx
            ON mailbox_entry_attachments (mailbox_entry_id, ordinal);
    `)
    db.exec("PRAGMA user_version = 5;")
}

function migrateToV6(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE session_reply_targets (
            session_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            conversation_key TEXT NOT NULL,
            delivery_channel TEXT NOT NULL,
            delivery_target TEXT NOT NULL,
            delivery_topic TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (session_id, ordinal)
        );

        CREATE INDEX session_reply_targets_conversation_key_updated_at_ms_idx
            ON session_reply_targets (conversation_key, updated_at_ms DESC);

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

        CREATE UNIQUE INDEX pending_questions_request_target_topic_idx
            ON pending_questions (request_id, delivery_channel, delivery_target, delivery_topic);

        CREATE INDEX pending_questions_target_topic_created_at_ms_idx
            ON pending_questions (delivery_channel, delivery_target, delivery_topic, created_at_ms);

        CREATE INDEX pending_questions_session_id_created_at_ms_idx
            ON pending_questions (session_id, created_at_ms);
    `)
    db.exec("PRAGMA user_version = 6;")
}

function migrateToV7(db: SqliteDatabaseLike): void {
    db.exec(`
        ALTER TABLE cron_jobs
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'cron';

        ALTER TABLE cron_jobs
        ADD COLUMN run_at_ms INTEGER;
    `)
    db.exec("PRAGMA user_version = 7;")
}

function migrateToV8(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE pending_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            delivery_channel TEXT NOT NULL,
            delivery_target TEXT NOT NULL,
            delivery_topic TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            telegram_message_id INTEGER,
            created_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX pending_interactions_request_target_topic_idx
            ON pending_interactions (request_id, delivery_channel, delivery_target, delivery_topic);

        CREATE INDEX pending_interactions_target_topic_created_at_ms_idx
            ON pending_interactions (delivery_channel, delivery_target, delivery_topic, created_at_ms);

        CREATE INDEX pending_interactions_session_id_created_at_ms_idx
            ON pending_interactions (session_id, created_at_ms);

        INSERT INTO pending_interactions (
            request_id,
            session_id,
            kind,
            delivery_channel,
            delivery_target,
            delivery_topic,
            payload_json,
            telegram_message_id,
            created_at_ms
        )
        SELECT
            request_id,
            session_id,
            'question',
            delivery_channel,
            delivery_target,
            delivery_topic,
            question_json,
            telegram_message_id,
            created_at_ms
        FROM pending_questions;

        DROP TABLE pending_questions;
    `)
    db.exec("PRAGMA user_version = 8;")
}

function migrateToV9(db: SqliteDatabaseLike): void {
    db.exec(`
        DROP TABLE IF EXISTS session_bindings;

        CREATE TABLE session_bindings (
            conversation_key TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        DROP TABLE IF EXISTS mailbox_deliveries;
        DROP TABLE IF EXISTS mailbox_job_entries;
        DROP TABLE IF EXISTS mailbox_jobs;
        DROP TABLE IF EXISTS mailbox_entry_attachments;
        DROP TABLE IF EXISTS mailbox_entries;

        CREATE TABLE mailbox_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            external_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            body TEXT NOT NULL,
            reply_channel TEXT,
            reply_target TEXT,
            reply_topic TEXT,
            created_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX mailbox_entries_source_kind_external_id_idx
            ON mailbox_entries (source_kind, external_id);

        CREATE INDEX mailbox_entries_mailbox_key_id_idx
            ON mailbox_entries (mailbox_key, id);

        CREATE TABLE mailbox_entry_attachments (
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_name TEXT,
            local_path TEXT NOT NULL,
            PRIMARY KEY (mailbox_entry_id, ordinal)
        );

        CREATE INDEX mailbox_entry_attachments_entry_id_ordinal_idx
            ON mailbox_entry_attachments (mailbox_entry_id, ordinal);

        CREATE TABLE mailbox_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            response_text TEXT,
            final_text TEXT,
            session_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            started_at_ms INTEGER,
            finished_at_ms INTEGER
        );

        CREATE INDEX mailbox_jobs_status_next_attempt_created_at_idx
            ON mailbox_jobs (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_jobs_mailbox_key_created_at_idx
            ON mailbox_jobs (mailbox_key, created_at_ms, id);

        CREATE TABLE mailbox_job_entries (
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            PRIMARY KEY (job_id, ordinal),
            UNIQUE (mailbox_entry_id)
        );

        CREATE INDEX mailbox_job_entries_mailbox_entry_id_idx
            ON mailbox_job_entries (mailbox_entry_id);

        CREATE TABLE mailbox_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            delivery_channel TEXT NOT NULL,
            delivery_target TEXT NOT NULL,
            delivery_topic TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            delivered_at_ms INTEGER
        );

        CREATE UNIQUE INDEX mailbox_deliveries_job_target_topic_idx
            ON mailbox_deliveries (job_id, delivery_channel, delivery_target, delivery_topic);

        CREATE INDEX mailbox_deliveries_status_next_attempt_created_at_idx
            ON mailbox_deliveries (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_deliveries_job_id_status_idx
            ON mailbox_deliveries (job_id, status, id);
    `)
    db.exec("PRAGMA user_version = 9;")
}

function migrateToV10(db: SqliteDatabaseLike): void {
    db.exec(`
        DROP TABLE IF EXISTS mailbox_deliveries;
        DROP TABLE IF EXISTS mailbox_job_entries;
        DROP TABLE IF EXISTS mailbox_jobs;
        DROP TABLE IF EXISTS mailbox_entry_attachments;
        DROP TABLE IF EXISTS mailbox_entries;

        CREATE TABLE mailbox_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            external_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            body TEXT NOT NULL,
            reply_channel TEXT,
            reply_target TEXT,
            reply_topic TEXT,
            created_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX mailbox_entries_source_kind_external_id_idx
            ON mailbox_entries (source_kind, external_id);

        CREATE INDEX mailbox_entries_mailbox_key_id_idx
            ON mailbox_entries (mailbox_key, id);

        CREATE TABLE mailbox_entry_attachments (
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_name TEXT,
            local_path TEXT NOT NULL,
            PRIMARY KEY (mailbox_entry_id, ordinal)
        );

        CREATE INDEX mailbox_entry_attachments_entry_id_ordinal_idx
            ON mailbox_entry_attachments (mailbox_entry_id, ordinal);

        CREATE TABLE mailbox_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            response_text TEXT,
            final_text TEXT,
            session_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            started_at_ms INTEGER,
            finished_at_ms INTEGER
        );

        CREATE INDEX mailbox_jobs_status_next_attempt_created_at_idx
            ON mailbox_jobs (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_jobs_mailbox_key_created_at_idx
            ON mailbox_jobs (mailbox_key, created_at_ms, id);

        CREATE TABLE mailbox_job_entries (
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            PRIMARY KEY (job_id, ordinal),
            UNIQUE (mailbox_entry_id)
        );

        CREATE INDEX mailbox_job_entries_mailbox_entry_id_idx
            ON mailbox_job_entries (mailbox_entry_id);

        CREATE TABLE mailbox_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            delivery_channel TEXT NOT NULL,
            delivery_target TEXT NOT NULL,
            delivery_topic TEXT NOT NULL,
            stream_message_id INTEGER,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            delivered_at_ms INTEGER
        );

        CREATE UNIQUE INDEX mailbox_deliveries_job_target_topic_idx
            ON mailbox_deliveries (job_id, delivery_channel, delivery_target, delivery_topic);

        CREATE INDEX mailbox_deliveries_status_next_attempt_created_at_idx
            ON mailbox_deliveries (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_deliveries_job_id_status_idx
            ON mailbox_deliveries (job_id, status, id);
    `)
    db.exec("PRAGMA user_version = 10;")
}

function migrateToV11(db: SqliteDatabaseLike): void {
    db.exec(`
        DROP TABLE IF EXISTS mailbox_deliveries;
        DROP TABLE IF EXISTS mailbox_job_entries;
        DROP TABLE IF EXISTS mailbox_jobs;
        DROP TABLE IF EXISTS mailbox_entry_attachments;
        DROP TABLE IF EXISTS mailbox_entries;

        CREATE TABLE mailbox_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            external_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            body TEXT NOT NULL,
            reply_channel TEXT,
            reply_target TEXT,
            reply_topic TEXT,
            created_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX mailbox_entries_source_kind_external_id_idx
            ON mailbox_entries (source_kind, external_id);

        CREATE INDEX mailbox_entries_mailbox_key_id_idx
            ON mailbox_entries (mailbox_key, id);

        CREATE TABLE mailbox_entry_attachments (
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_name TEXT,
            local_path TEXT NOT NULL,
            PRIMARY KEY (mailbox_entry_id, ordinal)
        );

        CREATE INDEX mailbox_entry_attachments_entry_id_ordinal_idx
            ON mailbox_entry_attachments (mailbox_entry_id, ordinal);

        CREATE TABLE mailbox_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mailbox_key TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            response_text TEXT,
            final_text TEXT,
            session_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            started_at_ms INTEGER,
            finished_at_ms INTEGER
        );

        CREATE INDEX mailbox_jobs_status_next_attempt_created_at_idx
            ON mailbox_jobs (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_jobs_mailbox_key_created_at_idx
            ON mailbox_jobs (mailbox_key, created_at_ms, id);

        CREATE TABLE mailbox_job_entries (
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            mailbox_entry_id INTEGER NOT NULL REFERENCES mailbox_entries(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            PRIMARY KEY (job_id, ordinal),
            UNIQUE (mailbox_entry_id)
        );

        CREATE INDEX mailbox_job_entries_mailbox_entry_id_idx
            ON mailbox_job_entries (mailbox_entry_id);

        CREATE TABLE mailbox_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL REFERENCES mailbox_jobs(id) ON DELETE CASCADE,
            delivery_channel TEXT NOT NULL,
            delivery_target TEXT NOT NULL,
            delivery_topic TEXT NOT NULL,
            delivery_mode TEXT NOT NULL,
            stream_message_id INTEGER,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            next_attempt_at_ms INTEGER NOT NULL,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            delivered_at_ms INTEGER
        );

        CREATE UNIQUE INDEX mailbox_deliveries_job_target_topic_idx
            ON mailbox_deliveries (job_id, delivery_channel, delivery_target, delivery_topic);

        CREATE INDEX mailbox_deliveries_status_next_attempt_created_at_idx
            ON mailbox_deliveries (status, next_attempt_at_ms, created_at_ms, id);

        CREATE INDEX mailbox_deliveries_job_id_status_idx
            ON mailbox_deliveries (job_id, status, id);
    `)
    db.exec("PRAGMA user_version = 11;")
}

function migrateToV12(db: SqliteDatabaseLike): void {
    db.exec(`
        ALTER TABLE mailbox_deliveries
        ADD COLUMN preview_process_text TEXT;

        ALTER TABLE mailbox_deliveries
        ADD COLUMN preview_reasoning_text TEXT;
    `)
    db.exec("PRAGMA user_version = 12;")
}

function migrateToV13(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE telegram_message_cleanup_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            next_attempt_at_ms INTEGER NOT NULL,
            attempt_count INTEGER NOT NULL,
            leased_until_ms INTEGER,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX telegram_message_cleanup_jobs_chat_message_idx
            ON telegram_message_cleanup_jobs (chat_id, message_id);

        CREATE INDEX telegram_message_cleanup_jobs_next_attempt_idx
            ON telegram_message_cleanup_jobs (next_attempt_at_ms, leased_until_ms, id);
    `)
    db.exec("PRAGMA user_version = 13;")
}

function migrateToV14(db: SqliteDatabaseLike): void {
    db.exec(`
        ALTER TABLE mailbox_deliveries
        ADD COLUMN preview_tool_sections_json TEXT;
    `)
    db.exec("PRAGMA user_version = 14;")
}

function migrateToV15(db: SqliteDatabaseLike): void {
    db.exec(`
        CREATE TABLE telegram_preview_messages (
            chat_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            tool_visibility TEXT NOT NULL,
            process_text TEXT,
            reasoning_text TEXT,
            answer_text TEXT,
            tool_sections_json TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (chat_id, message_id)
        );
    `)
    db.exec("PRAGMA user_version = 15;")
}

function migrateToV16(db: SqliteDatabaseLike): void {
    db.exec(`
        DROP TABLE IF EXISTS telegram_preview_messages;

        CREATE TABLE telegram_preview_messages (
            chat_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            view_mode TEXT NOT NULL,
            tools_page INTEGER NOT NULL,
            process_text TEXT,
            reasoning_text TEXT,
            answer_text TEXT,
            tool_sections_json TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (chat_id, message_id)
        );
    `)
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION};`)
}
