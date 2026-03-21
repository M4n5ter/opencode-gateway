import type { Database } from "bun:sqlite"

const LATEST_SCHEMA_VERSION = 4

export function migrateGatewayDatabase(db: Database): void {
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
    }
}

function readUserVersion(db: Database): number {
    const row = db.query<{ user_version: number }, []>("PRAGMA user_version;").get()
    return row?.user_version ?? 0
}

function migrateToV1(db: Database): void {
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

function migrateToV2(db: Database): void {
    db.exec(`
        CREATE TABLE kv_state (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
    `)
    db.exec("PRAGMA user_version = 2;")
}

function migrateToV3(db: Database): void {
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

function migrateToV4(db: Database): void {
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
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION};`)
}
