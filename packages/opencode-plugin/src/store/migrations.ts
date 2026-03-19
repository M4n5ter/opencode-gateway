import type { Database } from "bun:sqlite"

const LATEST_SCHEMA_VERSION = 1

export function migrateGatewayDatabase(db: Database): void {
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA foreign_keys = ON;")

    const currentVersion = readUserVersion(db)
    if (currentVersion === LATEST_SCHEMA_VERSION) {
        return
    }

    if (currentVersion !== 0) {
        throw new Error(`unsupported gateway database schema version: ${currentVersion}`)
    }

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
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION};`)
}

function readUserVersion(db: Database): number {
    const row = db.query<{ user_version: number }, []>("PRAGMA user_version;").get()
    return row?.user_version ?? 0
}
