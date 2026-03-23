import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import type { BindingDeliveryTarget } from "../binding"
import type { GatewayQuestionInfo, PendingQuestionRecord } from "../questions/types"
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
    text: string | null
    attachments: MailboxEntryAttachmentRecord[]
    replyChannel: string | null
    replyTarget: string | null
    replyTopic: string | null
    createdAtMs: number
}

export type MailboxEntryAttachmentRecord = {
    kind: "image"
    ordinal: number
    mimeType: string
    fileName: string | null
    localPath: string
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
    text: string | null
    attachments: PersistMailboxEntryAttachmentInput[]
    replyChannel: string | null
    replyTarget: string | null
    replyTopic: string | null
    recordedAtMs: number
}

export type PersistMailboxEntryAttachmentInput = {
    kind: "image"
    mimeType: string
    fileName: string | null
    localPath: string
}

export type PersistSessionReplyTargetsInput = {
    sessionId: string
    conversationKey: string
    targets: BindingDeliveryTarget[]
    recordedAtMs: number
}

export type PersistPendingQuestionInput = {
    requestId: string
    sessionId: string
    questions: GatewayQuestionInfo[]
    targets: Array<{
        deliveryTarget: BindingDeliveryTarget
        telegramMessageId: number | null
    }>
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

    replaceSessionReplyTargets(input: PersistSessionReplyTargetsInput): void {
        assertSafeInteger(input.recordedAtMs, "session reply-target recordedAtMs")
        const deleteTargets = this.db.query("DELETE FROM session_reply_targets WHERE session_id = ?1;")
        const insertTarget = this.db.query(
            `
                INSERT INTO session_reply_targets (
                    session_id,
                    ordinal,
                    conversation_key,
                    delivery_channel,
                    delivery_target,
                    delivery_topic,
                    updated_at_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);
            `,
        )

        this.db.transaction((payload: PersistSessionReplyTargetsInput) => {
            deleteTargets.run(payload.sessionId)

            for (const [ordinal, target] of payload.targets.entries()) {
                insertTarget.run(
                    payload.sessionId,
                    ordinal,
                    payload.conversationKey,
                    target.channel,
                    target.target,
                    normalizeKeyField(target.topic),
                    payload.recordedAtMs,
                )
            }
        })(input)
    }

    listSessionReplyTargets(sessionId: string): BindingDeliveryTarget[] {
        const rows = this.db
            .query<SessionReplyTargetRow, [string]>(
                `
                    SELECT
                        session_id,
                        ordinal,
                        conversation_key,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        updated_at_ms
                    FROM session_reply_targets
                    WHERE session_id = ?1
                    ORDER BY ordinal ASC;
                `,
            )
            .all(sessionId)

        return rows.map(mapSessionReplyTargetRow)
    }

    getDefaultSessionReplyTarget(sessionId: string): BindingDeliveryTarget | null {
        const row = this.db
            .query<SessionReplyTargetRow, [string]>(
                `
                    SELECT
                        session_id,
                        ordinal,
                        conversation_key,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        updated_at_ms
                    FROM session_reply_targets
                    WHERE session_id = ?1
                    ORDER BY ordinal ASC
                    LIMIT 1;
                `,
            )
            .get(sessionId)

        return row ? mapSessionReplyTargetRow(row) : null
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

    replacePendingQuestion(input: PersistPendingQuestionInput): void {
        assertSafeInteger(input.recordedAtMs, "pending question recordedAtMs")
        const deleteQuestion = this.db.query("DELETE FROM pending_questions WHERE request_id = ?1;")
        const insertQuestion = this.db.query(
            `
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
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
            `,
        )

        this.db.transaction((payload: PersistPendingQuestionInput) => {
            deleteQuestion.run(payload.requestId)

            for (const target of payload.targets) {
                insertQuestion.run(
                    payload.requestId,
                    payload.sessionId,
                    target.deliveryTarget.channel,
                    target.deliveryTarget.target,
                    normalizeKeyField(target.deliveryTarget.topic),
                    JSON.stringify(payload.questions),
                    target.telegramMessageId,
                    payload.recordedAtMs,
                )
            }
        })(input)
    }

    deletePendingQuestion(requestId: string): void {
        this.db.query("DELETE FROM pending_questions WHERE request_id = ?1;").run(requestId)
    }

    getPendingQuestionForTarget(target: BindingDeliveryTarget): PendingQuestionRecord | null {
        const row = this.db
            .query<PendingQuestionRow, [string, string, string]>(
                `
                    SELECT
                        id,
                        request_id,
                        session_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        question_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_questions
                    WHERE delivery_channel = ?1
                      AND delivery_target = ?2
                      AND delivery_topic = ?3
                    ORDER BY created_at_ms ASC, id ASC
                    LIMIT 1;
                `,
            )
            .get(target.channel, target.target, normalizeKeyField(target.topic))

        return row ? mapPendingQuestionRow(row) : null
    }

    getPendingQuestionForTelegramMessage(
        target: BindingDeliveryTarget,
        telegramMessageId: number,
    ): PendingQuestionRecord | null {
        assertSafeInteger(telegramMessageId, "pending question telegramMessageId")
        const row = this.db
            .query<PendingQuestionRow, [string, string, string, number]>(
                `
                    SELECT
                        id,
                        request_id,
                        session_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        question_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_questions
                    WHERE delivery_channel = ?1
                      AND delivery_target = ?2
                      AND delivery_topic = ?3
                      AND telegram_message_id = ?4
                    ORDER BY created_at_ms ASC, id ASC
                    LIMIT 1;
                `,
            )
            .get(target.channel, target.target, normalizeKeyField(target.topic), telegramMessageId)

        return row ? mapPendingQuestionRow(row) : null
    }

    hasMailboxEntry(sourceKind: string, externalId: string): boolean {
        const row = this.db
            .query<{ present: number }, [string, string]>(
                `
                    SELECT 1 AS present
                    FROM mailbox_entries
                    WHERE source_kind = ?1 AND external_id = ?2
                    LIMIT 1;
                `,
            )
            .get(sourceKind, externalId)

        return row?.present === 1
    }

    enqueueMailboxEntry(input: PersistMailboxEntryInput): void {
        assertSafeInteger(input.recordedAtMs, "mailbox recordedAtMs")
        const insertEntry = this.db.query(
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
        const insertAttachment = this.db.query(
            `
                INSERT INTO mailbox_entry_attachments (
                    mailbox_entry_id,
                    ordinal,
                    kind,
                    mime_type,
                    file_name,
                    local_path
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6);
            `,
        )

        this.db.transaction((payload: PersistMailboxEntryInput) => {
            const result = insertEntry.run(
                payload.mailboxKey,
                payload.sourceKind,
                payload.externalId,
                payload.sender,
                payload.text ?? "",
                payload.replyChannel,
                payload.replyTarget,
                payload.replyTopic,
                payload.recordedAtMs,
            )

            if (result.changes === 0) {
                return
            }

            const entryId = Number(result.lastInsertRowid)
            for (const [index, attachment] of payload.attachments.entries()) {
                insertAttachment.run(
                    entryId,
                    index,
                    attachment.kind,
                    attachment.mimeType,
                    attachment.fileName,
                    attachment.localPath,
                )
            }
        })(input)
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

        const attachments = listMailboxAttachments(
            this.db,
            rows.map((row) => row.id),
        )

        return rows.map((row) => mapMailboxEntryRow(row, attachments.get(row.id) ?? []))
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

type MailboxEntryAttachmentRow = {
    mailbox_entry_id: number
    ordinal: number
    kind: string
    mime_type: string
    file_name: string | null
    local_path: string
}

type SessionReplyTargetRow = {
    session_id: string
    ordinal: number
    conversation_key: string
    delivery_channel: string
    delivery_target: string
    delivery_topic: string
    updated_at_ms: number
}

type PendingQuestionRow = {
    id: number
    request_id: string
    session_id: string
    delivery_channel: string
    delivery_target: string
    delivery_topic: string
    question_json: string
    telegram_message_id: number | null
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

function mapMailboxEntryRow(row: MailboxEntryRow, attachments: MailboxEntryAttachmentRecord[]): MailboxEntryRecord {
    return {
        id: row.id,
        mailboxKey: row.mailbox_key,
        sourceKind: row.source_kind,
        externalId: row.external_id,
        sender: row.sender,
        text: normalizeStoredMailboxText(row.body),
        attachments,
        replyChannel: row.reply_channel,
        replyTarget: row.reply_target,
        replyTopic: row.reply_topic,
        createdAtMs: row.created_at_ms,
    }
}

function listMailboxAttachments(db: Database, entryIds: number[]): Map<number, MailboxEntryAttachmentRecord[]> {
    if (entryIds.length === 0) {
        return new Map()
    }

    for (const entryId of entryIds) {
        assertSafeInteger(entryId, "mailbox entry id")
    }
    const placeholders = entryIds.map((_, index) => `?${index + 1}`).join(", ")
    const rows = db
        .query<MailboxEntryAttachmentRow, number[]>(
            `
                SELECT
                    mailbox_entry_id,
                    ordinal,
                    kind,
                    mime_type,
                    file_name,
                    local_path
                FROM mailbox_entry_attachments
                WHERE mailbox_entry_id IN (${placeholders})
                ORDER BY mailbox_entry_id ASC, ordinal ASC;
            `,
        )
        .all(...entryIds)

    const attachments = new Map<number, MailboxEntryAttachmentRecord[]>()
    for (const row of rows) {
        const records = attachments.get(row.mailbox_entry_id) ?? []
        records.push(mapMailboxEntryAttachmentRow(row))
        attachments.set(row.mailbox_entry_id, records)
    }

    return attachments
}

function mapMailboxEntryAttachmentRow(row: MailboxEntryAttachmentRow): MailboxEntryAttachmentRecord {
    switch (row.kind) {
        case "image":
            return {
                kind: "image",
                ordinal: row.ordinal,
                mimeType: row.mime_type,
                fileName: row.file_name,
                localPath: row.local_path,
            }
        default:
            throw new Error(`unsupported mailbox attachment kind: ${row.kind}`)
    }
}

function mapSessionReplyTargetRow(row: SessionReplyTargetRow): BindingDeliveryTarget {
    return {
        channel: row.delivery_channel,
        target: row.delivery_target,
        topic: normalizeStoredKeyField(row.delivery_topic),
    }
}

function mapPendingQuestionRow(row: PendingQuestionRow): PendingQuestionRecord {
    return {
        requestId: row.request_id,
        sessionId: row.session_id,
        questions: parsePendingQuestions(row.question_json),
        deliveryTarget: {
            channel: row.delivery_channel,
            target: row.delivery_target,
            topic: normalizeStoredKeyField(row.delivery_topic),
        },
        telegramMessageId: row.telegram_message_id,
        createdAtMs: row.created_at_ms,
    }
}

function parsePendingQuestions(value: string): GatewayQuestionInfo[] {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
        throw new Error("stored pending question payload is invalid")
    }

    return parsed.map((question, index) => {
        if (typeof question !== "object" || question === null) {
            throw new Error(`stored pending question ${index} is invalid`)
        }

        const header = readRequiredStringField(question, "header")
        const prompt = readRequiredStringField(question, "question")
        const rawOptions = readArrayField(question, "options")
        const options = rawOptions.map((option, optionIndex) => {
            if (typeof option !== "object" || option === null) {
                throw new Error(`stored pending question option ${index}:${optionIndex} is invalid`)
            }

            return {
                label: readRequiredStringField(option, "label"),
                description: readRequiredStringField(option, "description"),
            }
        })

        return {
            header,
            question: prompt,
            options,
            multiple: readBooleanField(question, "multiple", false),
            custom: readBooleanField(question, "custom", true),
        }
    })
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

function normalizeStoredMailboxText(value: string): string | null {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function normalizeKeyField(value: string | null): string {
    if (value === null) {
        return ""
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? "" : trimmed
}

function normalizeStoredKeyField(value: string): string | null {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function readRequiredStringField(value: object, field: string): string {
    const raw = (value as Record<string, unknown>)[field]
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw
}

function readArrayField(value: object, field: string): unknown[] {
    const raw = (value as Record<string, unknown>)[field]
    if (!Array.isArray(raw)) {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw
}

function readBooleanField(value: object, field: string, fallback: boolean): boolean {
    const raw = (value as Record<string, unknown>)[field]
    if (raw === undefined) {
        return fallback
    }

    if (typeof raw !== "boolean") {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw
}

export async function openSqliteStore(path: string): Promise<SqliteStore> {
    await mkdir(dirname(path), { recursive: true })

    const db = new Database(path)
    migrateGatewayDatabase(db)

    return new SqliteStore(db)
}
