import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { migrateGatewayDatabase } from "./migrations"

export type RuntimeJournalKind = "inbound_message" | "cron_dispatch" | "delivery"

export type RuntimeJournalEntry = {
    kind: RuntimeJournalKind
    recordedAtMs: number
    conversationKey: string | null
    payload: unknown
}

export class SqliteStore {
    constructor(private readonly db: Database) {}

    getSessionBinding(conversationKey: string): string | null {
        const row = this.db
            .query<{ session_id: string }, [string]>(
                "SELECT session_id FROM session_bindings WHERE conversation_key = ?1;",
            )
            .get(conversationKey)

        return row?.session_id ?? null
    }

    putSessionBinding(conversationKey: string, sessionId: string, recordedAtMs: number): void {
        this.db
            .query(
                `
                    INSERT INTO session_bindings (conversation_key, session_id, updated_at_ms)
                    VALUES (?1, ?2, ?3)
                    ON CONFLICT(conversation_key) DO UPDATE SET
                        session_id = excluded.session_id,
                        updated_at_ms = excluded.updated_at_ms;
                `,
            )
            .run(conversationKey, sessionId, recordedAtMs)
    }

    appendJournal(entry: RuntimeJournalEntry): void {
        this.db
            .query(
                `
                    INSERT INTO runtime_journal (kind, recorded_at_ms, conversation_key, payload_json)
                    VALUES (?1, ?2, ?3, ?4);
                `,
            )
            .run(entry.kind, entry.recordedAtMs, entry.conversationKey, JSON.stringify(entry.payload))
    }

    getTelegramUpdateOffset(): number | null {
        const row = this.db
            .query<{ value: string }, [string]>("SELECT value FROM kv_state WHERE key = ?1;")
            .get("telegram.update_offset")

        if (!row) {
            return null
        }

        const value = Number.parseInt(row.value, 10)
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`stored telegram.update_offset is invalid: ${row.value}`)
        }

        return value
    }

    putTelegramUpdateOffset(offset: number, recordedAtMs: number): void {
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error(`telegram update offset is out of range: ${offset}`)
        }

        this.db
            .query(
                `
                    INSERT INTO kv_state (key, value, updated_at_ms)
                    VALUES (?1, ?2, ?3)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at_ms = excluded.updated_at_ms;
                `,
            )
            .run("telegram.update_offset", String(offset), recordedAtMs)
    }

    close(): void {
        this.db.close()
    }
}

export async function openSqliteStore(path: string): Promise<SqliteStore> {
    await mkdir(dirname(path), { recursive: true })

    const db = new Database(path)
    migrateGatewayDatabase(db)

    return new SqliteStore(db)
}
