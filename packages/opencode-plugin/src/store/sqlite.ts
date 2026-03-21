import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { migrateGatewayDatabase } from "./migrations"

export type RuntimeJournalKind = "inbound_message" | "cron_dispatch" | "delivery" | "mailbox_enqueue" | "mailbox_flush"
export type CronRunStatus = "running" | "succeeded" | "failed" | "abandoned"

export type RuntimeJournalEntry = {
    kind: RuntimeJournalKind
    recordedAtMs: number
    conversationKey: string | null
    payload: unknown
}

export type CronJobRecord = {
    id: string
    schedule: string
    prompt: string
    deliveryChannel: string | null
    deliveryTarget: string | null
    deliveryTopic: string | null
    enabled: boolean
    nextRunAtMs: number
    createdAtMs: number
    updatedAtMs: number
}

export type MailboxEntryRecord = {
    id: number
    mailboxKey: string
    sourceKind: string
    externalId: string
    sender: string
    body: string
    replyChannel: string | null
    replyTarget: string | null
    replyTopic: string | null
    createdAtMs: number
}

export type PersistCronJobInput = {
    id: string
    schedule: string
    prompt: string
    deliveryChannel: string | null
    deliveryTarget: string | null
    deliveryTopic: string | null
    enabled: boolean
    nextRunAtMs: number
    recordedAtMs: number
}

export type PersistMailboxEntryInput = {
    mailboxKey: string
    sourceKind: string
    externalId: string
    sender: string
    body: string
    replyChannel: string | null
    replyTarget: string | null
    replyTopic: string | null
    recordedAtMs: number
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

    deleteSessionBinding(conversationKey: string): void {
        this.db.query("DELETE FROM session_bindings WHERE conversation_key = ?1;").run(conversationKey)
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

    enqueueMailboxEntry(input: PersistMailboxEntryInput): void {
        assertSafeInteger(input.recordedAtMs, "mailbox recordedAtMs")

        this.db
            .query(
                `
                    INSERT INTO mailbox_entries (
                        mailbox_key,
                        source_kind,
                        external_id,
                        sender,
                        body,
                        reply_channel,
                        reply_target,
                        reply_topic,
                        created_at_ms
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                    ON CONFLICT(source_kind, external_id) DO NOTHING;
                `,
            )
            .run(
                input.mailboxKey,
                input.sourceKind,
                input.externalId,
                input.sender,
                input.body,
                input.replyChannel,
                input.replyTarget,
                input.replyTopic,
                input.recordedAtMs,
            )
    }

    listPendingMailboxKeys(): string[] {
        const rows = this.db
            .query<{ mailbox_key: string }, []>(
                `
                    SELECT DISTINCT mailbox_key
                    FROM mailbox_entries
                    ORDER BY mailbox_key ASC;
                `,
            )
            .all()

        return rows.map((row) => row.mailbox_key)
    }

    listMailboxEntries(mailboxKey: string): MailboxEntryRecord[] {
        const rows = this.db
            .query<MailboxEntryRow, [string]>(
                `
                    SELECT
                        id,
                        mailbox_key,
                        source_kind,
                        external_id,
                        sender,
                        body,
                        reply_channel,
                        reply_target,
                        reply_topic,
                        created_at_ms
                    FROM mailbox_entries
                    WHERE mailbox_key = ?1
                    ORDER BY id ASC;
                `,
            )
            .all(mailboxKey)

        return rows.map(mapMailboxEntryRow)
    }

    deleteMailboxEntries(ids: number[]): void {
        if (ids.length === 0) {
            return
        }

        for (const id of ids) {
            assertSafeInteger(id, "mailbox entry id")
        }
        const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ")

        this.db.query(`DELETE FROM mailbox_entries WHERE id IN (${placeholders});`).run(...ids)
    }

    getTelegramUpdateOffset(): number | null {
        const value = this.getStateValue("telegram.update_offset")
        if (value === null) {
            return null
        }

        return parseStoredInteger(value, "stored telegram.update_offset")
    }

    putTelegramUpdateOffset(offset: number, recordedAtMs: number): void {
        assertSafeInteger(offset, "telegram update offset")
        this.putStateValue("telegram.update_offset", String(offset), recordedAtMs)
    }

    getStateValue(key: string): string | null {
        const row = this.db.query<{ value: string }, [string]>("SELECT value FROM kv_state WHERE key = ?1;").get(key)

        return row?.value ?? null
    }

    putStateValue(key: string, value: string, recordedAtMs: number): void {
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
            .run(key, value, recordedAtMs)
    }

    upsertCronJob(input: PersistCronJobInput): void {
        assertSafeInteger(input.nextRunAtMs, "cron next_run_at_ms")
        assertSafeInteger(input.recordedAtMs, "cron recordedAtMs")

        this.db
            .query(
                `
                    INSERT INTO cron_jobs (
                        id,
                        schedule,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                    ON CONFLICT(id) DO UPDATE SET
                        schedule = excluded.schedule,
                        prompt = excluded.prompt,
                        delivery_channel = excluded.delivery_channel,
                        delivery_target = excluded.delivery_target,
                        delivery_topic = excluded.delivery_topic,
                        enabled = excluded.enabled,
                        next_run_at_ms = excluded.next_run_at_ms,
                        updated_at_ms = excluded.updated_at_ms;
                `,
            )
            .run(
                input.id,
                input.schedule,
                input.prompt,
                input.deliveryChannel,
                input.deliveryTarget,
                input.deliveryTopic,
                input.enabled ? 1 : 0,
                input.nextRunAtMs,
                input.recordedAtMs,
            )
    }

    getCronJob(id: string): CronJobRecord | null {
        const row = this.db
            .query<CronJobRow, [string]>(
                `
                    SELECT
                        id,
                        schedule,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    FROM cron_jobs
                    WHERE id = ?1;
                `,
            )
            .get(id)

        return row ? mapCronJobRow(row) : null
    }

    listCronJobs(): CronJobRecord[] {
        const rows = this.db
            .query<CronJobRow, []>(
                `
                    SELECT
                        id,
                        schedule,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    FROM cron_jobs
                    ORDER BY id ASC;
                `,
            )
            .all()

        return rows.map(mapCronJobRow)
    }

    listOverdueCronJobs(nowMs: number): CronJobRecord[] {
        assertSafeInteger(nowMs, "cron nowMs")

        const rows = this.db
            .query<CronJobRow, [number]>(
                `
                    SELECT
                        id,
                        schedule,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    FROM cron_jobs
                    WHERE enabled = 1 AND next_run_at_ms <= ?1
                    ORDER BY next_run_at_ms ASC, id ASC;
                `,
            )
            .all(nowMs)

        return rows.map(mapCronJobRow)
    }

    listDueCronJobs(nowMs: number, limit: number): CronJobRecord[] {
        assertSafeInteger(nowMs, "cron nowMs")
        assertSafeInteger(limit, "cron due-job limit")

        const rows = this.db
            .query<CronJobRow, [number, number]>(
                `
                    SELECT
                        id,
                        schedule,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    FROM cron_jobs
                    WHERE enabled = 1 AND next_run_at_ms <= ?1
                    ORDER BY next_run_at_ms ASC, id ASC
                    LIMIT ?2;
                `,
            )
            .all(nowMs, limit)

        return rows.map(mapCronJobRow)
    }

    removeCronJob(id: string): boolean {
        const result = this.db.query("DELETE FROM cron_jobs WHERE id = ?1;").run(id)
        return result.changes > 0
    }

    updateCronJobNextRun(id: string, nextRunAtMs: number, recordedAtMs: number): void {
        assertSafeInteger(nextRunAtMs, "cron next_run_at_ms")
        assertSafeInteger(recordedAtMs, "cron recordedAtMs")

        this.db
            .query(
                `
                    UPDATE cron_jobs
                    SET next_run_at_ms = ?2, updated_at_ms = ?3
                    WHERE id = ?1;
                `,
            )
            .run(id, nextRunAtMs, recordedAtMs)
    }

    insertCronRun(jobId: string, scheduledForMs: number, startedAtMs: number): number {
        assertSafeInteger(scheduledForMs, "cron scheduled_for_ms")
        assertSafeInteger(startedAtMs, "cron started_at_ms")

        const result = this.db
            .query(
                `
                    INSERT INTO cron_runs (
                        job_id,
                        scheduled_for_ms,
                        started_at_ms,
                        finished_at_ms,
                        status,
                        response_text,
                        error_message
                    )
                    VALUES (?1, ?2, ?3, NULL, 'running', NULL, NULL);
                `,
            )
            .run(jobId, scheduledForMs, startedAtMs)

        return Number(result.lastInsertRowid)
    }

    finishCronRun(
        runId: number,
        status: Exclude<CronRunStatus, "running">,
        finishedAtMs: number,
        responseText: string | null,
        errorMessage: string | null,
    ): void {
        assertSafeInteger(runId, "cron run id")
        assertSafeInteger(finishedAtMs, "cron finished_at_ms")

        this.db
            .query(
                `
                    UPDATE cron_runs
                    SET
                        finished_at_ms = ?2,
                        status = ?3,
                        response_text = ?4,
                        error_message = ?5
                    WHERE id = ?1;
                `,
            )
            .run(runId, finishedAtMs, status, responseText, errorMessage)
    }

    abandonRunningCronRuns(finishedAtMs: number): number {
        assertSafeInteger(finishedAtMs, "cron abandoned finished_at_ms")

        const result = this.db
            .query(
                `
                    UPDATE cron_runs
                    SET
                        finished_at_ms = ?1,
                        status = 'abandoned',
                        error_message = 'gateway process stopped before this run completed'
                    WHERE status = 'running';
                `,
            )
            .run(finishedAtMs)

        return result.changes
    }

    close(): void {
        this.db.close()
    }
}

type CronJobRow = {
    id: string
    schedule: string
    prompt: string
    delivery_channel: string | null
    delivery_target: string | null
    delivery_topic: string | null
    enabled: number
    next_run_at_ms: number
    created_at_ms: number
    updated_at_ms: number
}

type MailboxEntryRow = {
    id: number
    mailbox_key: string
    source_kind: string
    external_id: string
    sender: string
    body: string
    reply_channel: string | null
    reply_target: string | null
    reply_topic: string | null
    created_at_ms: number
}

function mapCronJobRow(row: CronJobRow): CronJobRecord {
    return {
        id: row.id,
        schedule: row.schedule,
        prompt: row.prompt,
        deliveryChannel: row.delivery_channel,
        deliveryTarget: row.delivery_target,
        deliveryTopic: row.delivery_topic,
        enabled: row.enabled === 1,
        nextRunAtMs: row.next_run_at_ms,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
    }
}

function mapMailboxEntryRow(row: MailboxEntryRow): MailboxEntryRecord {
    return {
        id: row.id,
        mailboxKey: row.mailbox_key,
        sourceKind: row.source_kind,
        externalId: row.external_id,
        sender: row.sender,
        body: row.body,
        replyChannel: row.reply_channel,
        replyTarget: row.reply_target,
        replyTopic: row.reply_topic,
        createdAtMs: row.created_at_ms,
    }
}

function assertSafeInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${field} is out of range: ${value}`)
    }
}

function parseStoredInteger(value: string, field: string): number {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${field} is invalid: ${value}`)
    }

    return parsed
}

export async function openSqliteStore(path: string): Promise<SqliteStore> {
    await mkdir(dirname(path), { recursive: true })

    const db = new Database(path)
    migrateGatewayDatabase(db)

    return new SqliteStore(db)
}
