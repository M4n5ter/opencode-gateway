import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import type { BindingDeferredDeliveryStrategy, BindingDeferredPreviewContext, BindingDeliveryTarget } from "../binding"
import type {
    GatewayInflightPolicyRequest,
    GatewayInteractionRequest,
    GatewayInteractionScope,
    GatewayPermissionRequest,
    GatewayQuestionInfo,
    GatewayQuestionRequest,
    PendingInteractionRecord,
} from "../interactions/types"
import type { TelegramPreviewViewMode } from "../telegram/stream-render"
import type { SqliteDatabaseLike } from "./database"
import { migrateGatewayDatabase } from "./migrations"

export type RuntimeJournalKind =
    | "inbound_message"
    | "cron_dispatch"
    | "delivery"
    | "mailbox_enqueue"
    | "mailbox_flush"
    | "mailbox_job_created"
    | "mailbox_job_quarantined"
    | "mailbox_delivery_queued"
    | "mailbox_delivery_quarantined"
    | "execution_timeout"
export type CronRunStatus = "running" | "succeeded" | "failed" | "abandoned"
export type ScheduleJobKind = "cron" | "once"

export type CronRunRecord = {
    id: number
    jobId: string
    scheduledForMs: number
    startedAtMs: number
    finishedAtMs: number | null
    status: CronRunStatus
    responseText: string | null
    errorMessage: string | null
}

export type RuntimeJournalEntry = {
    kind: RuntimeJournalKind
    recordedAtMs: number
    conversationKey: string | null
    payload: unknown
}

export type CronJobRecord = {
    id: string
    kind: ScheduleJobKind
    schedule: string | null
    runAtMs: number | null
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
    ingressState: MailboxEntryIngressState
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

export type MailboxEntryIngressState = "ready" | "held_for_inflight_policy"
export type MailboxJobStatus =
    | "pending"
    | "executing"
    | "ready_to_deliver"
    | "completed"
    | "interrupted"
    | "quarantined"
export type MailboxDeliveryStatus = "pending" | "delivering" | "delivered" | "quarantined"

export type MailboxJobRecord = {
    id: number
    mailboxKey: string
    status: MailboxJobStatus
    attemptCount: number
    leasedUntilMs: number | null
    nextAttemptAtMs: number
    lastError: string | null
    responseText: string | null
    finalText: string | null
    sessionId: string | null
    createdAtMs: number
    updatedAtMs: number
    startedAtMs: number | null
    finishedAtMs: number | null
    entries: MailboxEntryRecord[]
}

export type MailboxDeliveryRecord = {
    id: number
    jobId: number
    deliveryTarget: BindingDeliveryTarget
    strategy: BindingDeferredDeliveryStrategy
    previewContext: BindingDeferredPreviewContext | null
    status: MailboxDeliveryStatus
    attemptCount: number
    leasedUntilMs: number | null
    nextAttemptAtMs: number
    lastError: string | null
    createdAtMs: number
    updatedAtMs: number
    deliveredAtMs: number | null
}

export type MailboxPreparedDelivery = {
    deliveryTarget: BindingDeliveryTarget
    strategy: BindingDeferredDeliveryStrategy
    previewContext: BindingDeferredPreviewContext | null
}

export type TelegramMessageCleanupKind = "interaction" | "tool_activity"

export type TelegramMessageCleanupRecord = {
    id: number
    kind: TelegramMessageCleanupKind
    chatId: string
    messageId: number
    nextAttemptAtMs: number
    attemptCount: number
    leasedUntilMs: number | null
    lastError: string | null
    createdAtMs: number
    updatedAtMs: number
}

export type TelegramPreviewMessageRecord = {
    chatId: string
    messageId: number
    viewMode: TelegramPreviewViewMode
    previewPage: number
    toolsPage: number
    processText: string | null
    reasoningText: string | null
    answerText: string | null
    toolSections: NonNullable<BindingDeferredPreviewContext["toolSections"]>
    createdAtMs: number
    updatedAtMs: number
}

export type CompleteMailboxJobExecutionInput = {
    jobId: number
    sessionId: string
    responseText: string
    finalText: string | null
    deliveries: MailboxPreparedDelivery[]
    recordedAtMs: number
    deliveryRetryAtMs: number
}

export type MailboxJobFinalizeResult = {
    status: Extract<MailboxJobStatus, "ready_to_deliver" | "completed" | "interrupted" | "quarantined">
    cleanupEntries: MailboxEntryRecord[]
}

export type PersistCronJobInput = {
    id: string
    kind: ScheduleJobKind
    schedule: string | null
    runAtMs: number | null
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
    ingressState?: MailboxEntryIngressState
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

export type PersistPendingInteractionInput = {
    request: GatewayInteractionRequest
    targets: Array<{
        deliveryTarget: BindingDeliveryTarget
        telegramMessageId: number | null
    }>
    recordedAtMs: number
}

export class SqliteStore {
    constructor(private readonly db: SqliteDatabaseLike) {}

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

    putSessionBindingIfUnchanged(
        conversationKey: string,
        expectedSessionId: string | null,
        nextSessionId: string,
        recordedAtMs: number,
    ): boolean {
        const result =
            expectedSessionId === null
                ? this.db
                      .query(
                          `
                              INSERT INTO session_bindings (conversation_key, session_id, updated_at_ms)
                              VALUES (?1, ?2, ?3)
                              ON CONFLICT(conversation_key) DO NOTHING;
                          `,
                      )
                      .run(conversationKey, nextSessionId, recordedAtMs)
                : this.db
                      .query(
                          `
                              UPDATE session_bindings
                              SET session_id = ?2,
                                  updated_at_ms = ?3
                              WHERE conversation_key = ?1
                                AND session_id = ?4;
                          `,
                      )
                      .run(conversationKey, nextSessionId, recordedAtMs, expectedSessionId)

        return result.changes > 0
    }

    deleteSessionBinding(conversationKey: string): void {
        this.db.query("DELETE FROM session_bindings WHERE conversation_key = ?1;").run(conversationKey)
    }

    clearSessionReplyTargets(sessionId: string): void {
        this.db.query("DELETE FROM session_reply_targets WHERE session_id = ?1;").run(sessionId)
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

    hasGatewaySession(sessionId: string): boolean {
        const binding = this.db
            .query<{ present: number }, [string]>(
                `
                    SELECT 1 AS present
                    FROM session_bindings
                    WHERE session_id = ?1
                    LIMIT 1;
                `,
            )
            .get(sessionId)
        if (binding?.present === 1) {
            return true
        }

        const replyTarget = this.db
            .query<{ present: number }, [string]>(
                `
                    SELECT 1 AS present
                    FROM session_reply_targets
                    WHERE session_id = ?1
                    LIMIT 1;
                `,
            )
            .get(sessionId)

        return replyTarget?.present === 1
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

    replacePendingInteraction(input: PersistPendingInteractionInput): void {
        assertSafeInteger(input.recordedAtMs, "pending interaction recordedAtMs")
        const deleteInteraction = this.db.query("DELETE FROM pending_interactions WHERE request_id = ?1;")
        const insertInteraction = this.db.query(
            `
                INSERT INTO pending_interactions (
                    request_id,
                    kind,
                    scope_kind,
                    scope_id,
                    delivery_channel,
                    delivery_target,
                    delivery_topic,
                    payload_json,
                    telegram_message_id,
                    created_at_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);
            `,
        )

        this.db.transaction((payload: PersistPendingInteractionInput) => {
            deleteInteraction.run(payload.request.requestId)

            for (const target of payload.targets) {
                insertInteraction.run(
                    payload.request.requestId,
                    payload.request.kind,
                    payload.request.kind === "inflight_policy" ? "mailbox" : "session",
                    payload.request.kind === "inflight_policy" ? payload.request.mailboxKey : payload.request.sessionId,
                    target.deliveryTarget.channel,
                    target.deliveryTarget.target,
                    normalizeKeyField(target.deliveryTarget.topic),
                    encodePendingInteractionPayload(payload.request),
                    target.telegramMessageId,
                    payload.recordedAtMs,
                )
            }
        })(input)
    }

    deletePendingInteraction(requestId: string): void {
        this.db.query("DELETE FROM pending_interactions WHERE request_id = ?1;").run(requestId)
    }

    hasPendingInteraction(requestId: string): boolean {
        const row = this.db
            .query<{ present: number }, [string]>(
                `
                    SELECT 1 AS present
                    FROM pending_interactions
                    WHERE request_id = ?1
                    LIMIT 1;
                `,
            )
            .get(requestId)

        return row?.present === 1
    }

    deletePendingInteractionsForSession(sessionId: string): void {
        this.db.query("DELETE FROM pending_interactions WHERE scope_kind = 'session' AND scope_id = ?1;").run(sessionId)
    }

    deletePendingInteractionsForMailbox(mailboxKey: string): void {
        this.db
            .query("DELETE FROM pending_interactions WHERE scope_kind = 'mailbox' AND scope_id = ?1;")
            .run(mailboxKey)
    }

    listPendingInteractionsForMailbox(mailboxKey: string): PendingInteractionRecord[] {
        const rows = this.db
            .query<PendingInteractionRow, [string]>(
                `
                    SELECT
                        id,
                        request_id,
                        kind,
                        scope_kind,
                        scope_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        payload_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_interactions
                    WHERE scope_kind = 'mailbox'
                      AND scope_id = ?1
                    ORDER BY created_at_ms ASC, id ASC;
                `,
            )
            .all(mailboxKey)

        return rows.map(mapPendingInteractionRow)
    }

    clearLocalInflightInteractions(): void {
        this.db.query("DELETE FROM pending_interactions WHERE scope_kind = 'mailbox';").run()
    }

    getPendingInteractionForTarget(target: BindingDeliveryTarget): PendingInteractionRecord | null {
        const row = this.db
            .query<PendingInteractionRow, [string, string, string]>(
                `
                    SELECT
                        id,
                        request_id,
                        kind,
                        scope_kind,
                        scope_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        payload_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_interactions
                    WHERE delivery_channel = ?1
                      AND delivery_target = ?2
                      AND delivery_topic = ?3
                    ORDER BY created_at_ms ASC, id ASC
                    LIMIT 1;
                `,
            )
            .get(target.channel, target.target, normalizeKeyField(target.topic))

        return row ? mapPendingInteractionRow(row) : null
    }

    getPendingInteractionForTelegramMessage(
        target: BindingDeliveryTarget,
        telegramMessageId: number,
    ): PendingInteractionRecord | null {
        assertSafeInteger(telegramMessageId, "pending interaction telegramMessageId")
        const row = this.db
            .query<PendingInteractionRow, [string, string, string, number]>(
                `
                    SELECT
                        id,
                        request_id,
                        kind,
                        scope_kind,
                        scope_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        payload_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_interactions
                    WHERE delivery_channel = ?1
                      AND delivery_target = ?2
                      AND delivery_topic = ?3
                      AND telegram_message_id = ?4
                    ORDER BY created_at_ms ASC, id ASC
                    LIMIT 1;
                `,
            )
            .get(target.channel, target.target, normalizeKeyField(target.topic), telegramMessageId)

        return row ? mapPendingInteractionRow(row) : null
    }

    listPendingInteractionsByRequestId(requestId: string): PendingInteractionRecord[] {
        const rows = this.db
            .query<PendingInteractionRow, [string]>(
                `
                    SELECT
                        id,
                        request_id,
                        kind,
                        scope_kind,
                        scope_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        payload_json,
                        telegram_message_id,
                        created_at_ms
                    FROM pending_interactions
                    WHERE request_id = ?1
                    ORDER BY created_at_ms ASC, id ASC;
                `,
            )
            .all(requestId)

        return rows.map(mapPendingInteractionRow)
    }

    scheduleTelegramMessageCleanup(
        kind: TelegramMessageCleanupKind,
        chatId: string,
        messageId: number,
        notBeforeMs: number,
        recordedAtMs: number,
    ): void {
        assertSafeInteger(messageId, "telegram cleanup messageId")
        assertSafeInteger(notBeforeMs, "telegram cleanup notBeforeMs")
        assertSafeInteger(recordedAtMs, "telegram cleanup recordedAtMs")

        this.db
            .query(
                `
                    INSERT INTO telegram_message_cleanup_jobs (
                        kind,
                        chat_id,
                        message_id,
                        next_attempt_at_ms,
                        attempt_count,
                        leased_until_ms,
                        last_error,
                        created_at_ms,
                        updated_at_ms
                    )
                    VALUES (?1, ?2, ?3, ?4, 0, NULL, NULL, ?5, ?5)
                    ON CONFLICT(chat_id, message_id) DO UPDATE SET
                        kind = excluded.kind,
                        next_attempt_at_ms = MIN(telegram_message_cleanup_jobs.next_attempt_at_ms, excluded.next_attempt_at_ms),
                        leased_until_ms = NULL,
                        updated_at_ms = excluded.updated_at_ms;
                `,
            )
            .run(kind, chatId, messageId, notBeforeMs, recordedAtMs)
    }

    claimNextTelegramMessageCleanup(nowMs: number, leaseUntilMs: number): TelegramMessageCleanupRecord | null {
        assertSafeInteger(nowMs, "telegram cleanup nowMs")
        assertSafeInteger(leaseUntilMs, "telegram cleanup leaseUntilMs")

        const selectCandidate = this.db.query<{ id: number }, [number]>(
            `
                SELECT id
                FROM telegram_message_cleanup_jobs
                WHERE next_attempt_at_ms <= ?1
                  AND (leased_until_ms IS NULL OR leased_until_ms <= ?1)
                ORDER BY next_attempt_at_ms ASC, id ASC
                LIMIT 1;
            `,
        )
        const claimCandidate = this.db.query(
            `
                UPDATE telegram_message_cleanup_jobs
                SET
                    leased_until_ms = ?2,
                    attempt_count = attempt_count + 1,
                    updated_at_ms = ?3
                WHERE id = ?1
                  AND next_attempt_at_ms <= ?3
                  AND (leased_until_ms IS NULL OR leased_until_ms <= ?3);
            `,
        )

        return this.db.transaction((clockMs: number, deadlineMs: number) => {
            const candidate = selectCandidate.get(clockMs)
            if (candidate === null || candidate === undefined) {
                return null
            }

            const result = claimCandidate.run(candidate.id, deadlineMs, clockMs)
            if (result.changes === 0) {
                return null
            }

            return this.getTelegramMessageCleanup(candidate.id)
        })(nowMs, leaseUntilMs)
    }

    getTelegramMessageCleanup(jobId: number): TelegramMessageCleanupRecord | null {
        assertSafeInteger(jobId, "telegram cleanup id")
        const row = this.db
            .query<TelegramMessageCleanupRow, [number]>(
                `
                    SELECT
                        id,
                        kind,
                        chat_id,
                        message_id,
                        next_attempt_at_ms,
                        attempt_count,
                        leased_until_ms,
                        last_error,
                        created_at_ms,
                        updated_at_ms
                    FROM telegram_message_cleanup_jobs
                    WHERE id = ?1;
                `,
            )
            .get(jobId)

        return row ? mapTelegramCleanupRow(row) : null
    }

    listTelegramMessageCleanupJobs(): TelegramMessageCleanupRecord[] {
        return this.db
            .query<TelegramMessageCleanupRow, []>(
                `
                    SELECT
                        id,
                        kind,
                        chat_id,
                        message_id,
                        next_attempt_at_ms,
                        attempt_count,
                        leased_until_ms,
                        last_error,
                        created_at_ms,
                        updated_at_ms
                    FROM telegram_message_cleanup_jobs
                    ORDER BY next_attempt_at_ms ASC, id ASC;
                `,
            )
            .all()
            .map(mapTelegramCleanupRow)
    }

    completeTelegramMessageCleanup(jobId: number): void {
        assertSafeInteger(jobId, "telegram cleanup id")
        this.db.query("DELETE FROM telegram_message_cleanup_jobs WHERE id = ?1;").run(jobId)
    }

    recordTelegramMessageCleanupFailure(
        jobId: number,
        errorMessage: string,
        recordedAtMs: number,
        nextAttemptAtMs: number,
        maxAttempts: number,
    ): boolean {
        assertSafeInteger(jobId, "telegram cleanup id")
        assertSafeInteger(recordedAtMs, "telegram cleanup recordedAtMs")
        assertSafeInteger(nextAttemptAtMs, "telegram cleanup nextAttemptAtMs")
        assertSafeInteger(maxAttempts, "telegram cleanup maxAttempts")

        return this.db.transaction(
            (targetJobId: number, message: string, nowMs: number, retryAtMs: number, retryLimit: number) => {
                const row = this.db
                    .query<{ attempt_count: number }, [number]>(
                        "SELECT attempt_count FROM telegram_message_cleanup_jobs WHERE id = ?1 LIMIT 1;",
                    )
                    .get(targetJobId)
                if (row === null || row === undefined) {
                    throw new Error(`unknown telegram cleanup job: ${targetJobId}`)
                }

                if (row.attempt_count >= retryLimit) {
                    this.db.query("DELETE FROM telegram_message_cleanup_jobs WHERE id = ?1;").run(targetJobId)
                    return true
                }

                this.db
                    .query(
                        `
                            UPDATE telegram_message_cleanup_jobs
                            SET
                                leased_until_ms = NULL,
                                next_attempt_at_ms = ?2,
                                last_error = ?3,
                                updated_at_ms = ?4
                            WHERE id = ?1;
                        `,
                    )
                    .run(targetJobId, retryAtMs, message, nowMs)
                return false
            },
        )(jobId, errorMessage, recordedAtMs, nextAttemptAtMs, maxAttempts)
    }

    upsertTelegramPreviewMessage(input: {
        chatId: string
        messageId: number
        viewMode: TelegramPreviewViewMode
        previewPage: number
        toolsPage: number
        processText: string | null
        reasoningText: string | null
        answerText: string | null
        toolSections: NonNullable<BindingDeferredPreviewContext["toolSections"]>
        recordedAtMs: number
    }): void {
        assertSafeInteger(input.messageId, "telegram preview messageId")
        assertSafeInteger(input.recordedAtMs, "telegram preview recordedAtMs")
        assertSafeInteger(input.previewPage, "telegram preview previewPage")
        assertSafeInteger(input.toolsPage, "telegram preview toolsPage")

        this.db
            .query(
                `
                    INSERT INTO telegram_preview_messages (
                        chat_id,
                        message_id,
                        view_mode,
                        preview_page,
                        tools_page,
                        process_text,
                        reasoning_text,
                        answer_text,
                        tool_sections_json,
                        created_at_ms,
                        updated_at_ms
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
                    ON CONFLICT(chat_id, message_id) DO UPDATE SET
                        view_mode = excluded.view_mode,
                        preview_page = excluded.preview_page,
                        tools_page = excluded.tools_page,
                        process_text = excluded.process_text,
                        reasoning_text = excluded.reasoning_text,
                        answer_text = excluded.answer_text,
                        tool_sections_json = excluded.tool_sections_json,
                        updated_at_ms = excluded.updated_at_ms;
                `,
            )
            .run(
                input.chatId,
                input.messageId,
                input.viewMode,
                input.previewPage,
                input.toolsPage,
                normalizeStoredMailboxText(input.processText ?? ""),
                normalizeStoredMailboxText(input.reasoningText ?? ""),
                normalizeStoredMailboxText(input.answerText ?? ""),
                encodeMailboxToolSections(input.toolSections),
                input.recordedAtMs,
            )
    }

    getTelegramPreviewMessage(chatId: string, messageId: number): TelegramPreviewMessageRecord | null {
        assertSafeInteger(messageId, "telegram preview messageId")
        const row = this.db
            .query<TelegramPreviewMessageRow, [string, number]>(
                `
                    SELECT
                        chat_id,
                        message_id,
                        view_mode,
                        preview_page,
                        tools_page,
                        process_text,
                        reasoning_text,
                        answer_text,
                        tool_sections_json,
                        created_at_ms,
                        updated_at_ms
                    FROM telegram_preview_messages
                    WHERE chat_id = ?1
                      AND message_id = ?2
                    LIMIT 1;
                `,
            )
            .get(chatId, messageId)

        return row ? mapTelegramPreviewMessageRow(row) : null
    }

    setTelegramPreviewViewState(
        chatId: string,
        messageId: number,
        viewMode: TelegramPreviewViewMode,
        previewPage: number,
        toolsPage: number,
        recordedAtMs: number,
    ): TelegramPreviewMessageRecord | null {
        assertSafeInteger(messageId, "telegram preview messageId")
        assertSafeInteger(recordedAtMs, "telegram preview recordedAtMs")
        assertSafeInteger(previewPage, "telegram preview previewPage")
        assertSafeInteger(toolsPage, "telegram preview toolsPage")

        const updated = this.db
            .query(
                `
                    UPDATE telegram_preview_messages
                    SET
                        view_mode = ?3,
                        preview_page = ?4,
                        tools_page = ?5,
                        updated_at_ms = ?6
                    WHERE chat_id = ?1
                      AND message_id = ?2;
                `,
            )
            .run(chatId, messageId, viewMode, previewPage, toolsPage, recordedAtMs)

        if (updated.changes === 0) {
            return null
        }

        return this.getTelegramPreviewMessage(chatId, messageId)
    }

    deleteTelegramPreviewMessage(chatId: string, messageId: number): void {
        assertSafeInteger(messageId, "telegram preview messageId")
        this.db
            .query("DELETE FROM telegram_preview_messages WHERE chat_id = ?1 AND message_id = ?2;")
            .run(chatId, messageId)
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
                    ingress_state,
                    source_kind,
                    external_id,
                    sender,
                    body,
                    reply_channel,
                    reply_target,
                    reply_topic,
                    created_at_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
                payload.ingressState ?? "ready",
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

    releaseHeldMailboxEntries(mailboxKey: string, _recordedAtMs: number): number {
        return this.db
            .query(
                `
                    UPDATE mailbox_entries
                    SET ingress_state = 'ready'
                    WHERE mailbox_key = ?1
                      AND ingress_state = 'held_for_inflight_policy';
                `,
            )
            .run(mailboxKey).changes
    }

    releaseAllHeldMailboxEntries(_recordedAtMs: number): number {
        return this.db
            .query(
                `
                    UPDATE mailbox_entries
                    SET ingress_state = 'ready'
                    WHERE ingress_state = 'held_for_inflight_policy';
                `,
            )
            .run().changes
    }

    listHeldMailboxReplyTargets(mailboxKey: string): BindingDeliveryTarget[] {
        const rows = this.db
            .query<{ reply_channel: string | null; reply_target: string | null; reply_topic: string | null }, [string]>(
                `
                    SELECT DISTINCT reply_channel, reply_target, reply_topic
                    FROM mailbox_entries
                    WHERE mailbox_key = ?1
                      AND ingress_state = 'held_for_inflight_policy'
                      AND reply_channel IS NOT NULL
                      AND reply_target IS NOT NULL
                    ORDER BY rowid ASC;
                `,
            )
            .all(mailboxKey)

        return rows.map((row) => {
            if (row.reply_channel === null || row.reply_target === null) {
                throw new Error("held mailbox reply targets must include both channel and target")
            }

            return {
                channel: row.reply_channel,
                target: row.reply_target,
                topic: normalizeStoredKeyField(row.reply_topic ?? ""),
            }
        })
    }

    listPendingMailboxKeys(): string[] {
        const rows = this.db
            .query<{ mailbox_key: string }, []>(
                `
                    SELECT DISTINCT entry.mailbox_key
                    FROM mailbox_entries AS entry
                    LEFT JOIN mailbox_job_entries AS job_entry
                      ON job_entry.mailbox_entry_id = entry.id
                    WHERE job_entry.mailbox_entry_id IS NULL
                      AND entry.ingress_state = 'ready'
                    ORDER BY mailbox_key ASC;
                `,
            )
            .all()

        return rows.map((row) => row.mailbox_key)
    }

    materializeMailboxJobs(nowMs: number, batchReplies: boolean, batchWindowMs: number): number {
        assertSafeInteger(nowMs, "mailbox job materialize nowMs")
        assertSafeInteger(batchWindowMs, "mailbox job batchWindowMs")

        const listMailboxKeys = this.db.query<{ mailbox_key: string }, []>(
            `
                SELECT DISTINCT entry.mailbox_key
                FROM mailbox_entries AS entry
                LEFT JOIN mailbox_job_entries AS job_entry
                  ON job_entry.mailbox_entry_id = entry.id
                WHERE job_entry.mailbox_entry_id IS NULL
                ORDER BY entry.mailbox_key ASC;
            `,
        )
        const listUnassignedEntries = this.db.query<MailboxEntryRow, [string]>(
            `
                SELECT
                    entry.id,
                    entry.mailbox_key,
                    entry.ingress_state,
                    entry.source_kind,
                    entry.external_id,
                    entry.sender,
                    entry.body,
                    entry.reply_channel,
                    entry.reply_target,
                    entry.reply_topic,
                    entry.created_at_ms
                FROM mailbox_entries AS entry
                LEFT JOIN mailbox_job_entries AS job_entry
                  ON job_entry.mailbox_entry_id = entry.id
                WHERE entry.mailbox_key = ?1
                  AND job_entry.mailbox_entry_id IS NULL
                  AND entry.ingress_state = 'ready'
                ORDER BY entry.id ASC;
            `,
        )
        const mailboxHasBlockingJob = this.db.query<{ present: number }, [string]>(
            `
                SELECT 1 AS present
                FROM mailbox_jobs
                WHERE mailbox_key = ?1
                  AND status IN ('pending', 'executing')
                LIMIT 1;
            `,
        )
        const insertJob = this.db.query(
            `
                INSERT INTO mailbox_jobs (
                    mailbox_key,
                    status,
                    attempt_count,
                    leased_until_ms,
                    next_attempt_at_ms,
                    last_error,
                    response_text,
                    final_text,
                    session_id,
                    created_at_ms,
                    updated_at_ms,
                    started_at_ms,
                    finished_at_ms
                )
                VALUES (?1, 'pending', 0, NULL, ?2, NULL, NULL, NULL, NULL, ?3, ?4, NULL, NULL);
            `,
        )
        const insertJobEntry = this.db.query(
            `
                INSERT INTO mailbox_job_entries (job_id, mailbox_entry_id, ordinal)
                VALUES (?1, ?2, ?3);
            `,
        )
        const insertJournal = this.db.query(
            `
                INSERT INTO runtime_journal (kind, recorded_at_ms, conversation_key, payload_json)
                VALUES (?1, ?2, ?3, ?4);
            `,
        )

        return this.db.transaction((clockMs: number) => {
            let createdJobs = 0

            for (const row of listMailboxKeys.all()) {
                if (mailboxHasBlockingJob.get(row.mailbox_key)?.present === 1) {
                    continue
                }

                const entries = listUnassignedEntries.all(row.mailbox_key)
                if (entries.length === 0) {
                    continue
                }

                if (batchReplies && entries[0].created_at_ms + batchWindowMs > clockMs) {
                    continue
                }

                const result = insertJob.run(
                    row.mailbox_key,
                    clockMs,
                    batchReplies ? entries[0].created_at_ms : clockMs,
                    clockMs,
                )
                const jobId = Number(result.lastInsertRowid)
                const selectedEntryIds: number[] = []
                for (const [ordinal, entry] of entries.entries()) {
                    insertJobEntry.run(jobId, entry.id, ordinal)
                    selectedEntryIds.push(entry.id)
                    if (!batchReplies) {
                        break
                    }
                }
                insertJournal.run(
                    "mailbox_job_created",
                    clockMs,
                    row.mailbox_key,
                    JSON.stringify({
                        jobId,
                        entryIds: selectedEntryIds,
                    }),
                )

                createdJobs += 1
            }

            return createdJobs
        })(nowMs)
    }

    listMailboxEntries(mailboxKey: string): MailboxEntryRecord[] {
        const rows = this.db
            .query<MailboxEntryRow, [string]>(
                `
                    SELECT
                        id,
                        mailbox_key,
                        ingress_state,
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

    listMailboxJobs(): MailboxJobRecord[] {
        const rows = this.db
            .query<MailboxJobRow, []>(
                `
                    SELECT
                        id,
                        mailbox_key,
                        status,
                        attempt_count,
                        leased_until_ms,
                        next_attempt_at_ms,
                        last_error,
                        response_text,
                        final_text,
                        session_id,
                        created_at_ms,
                        updated_at_ms,
                        started_at_ms,
                        finished_at_ms
                    FROM mailbox_jobs
                    ORDER BY created_at_ms ASC, id ASC;
                `,
            )
            .all()

        return mapMailboxJobs(this.db, rows)
    }

    listMailboxDeliveries(jobId: number): MailboxDeliveryRecord[] {
        assertSafeInteger(jobId, "mailbox delivery jobId")
        const rows = this.db
            .query<MailboxDeliveryRow, [number]>(
                `
                    SELECT
                        id,
                        job_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        delivery_mode,
                        stream_message_id,
                        preview_process_text,
                        preview_reasoning_text,
                        preview_tool_sections_json,
                        status,
                        attempt_count,
                        leased_until_ms,
                        next_attempt_at_ms,
                        last_error,
                        created_at_ms,
                        updated_at_ms,
                        delivered_at_ms
                    FROM mailbox_deliveries
                    WHERE job_id = ?1
                    ORDER BY id ASC;
                `,
            )
            .all(jobId)

        return rows.map(mapMailboxDeliveryRow)
    }

    claimNextMailboxJob(nowMs: number, leaseUntilMs: number): MailboxJobRecord | null {
        assertSafeInteger(nowMs, "mailbox job claim nowMs")
        assertSafeInteger(leaseUntilMs, "mailbox job leaseUntilMs")

        const selectCandidate = this.db.query<{ id: number }, [number]>(
            `
                SELECT id
                FROM mailbox_jobs
                WHERE status = 'pending'
                  AND next_attempt_at_ms <= ?1
                ORDER BY created_at_ms ASC, id ASC
                LIMIT 1;
            `,
        )
        const claimJob = this.db.query(
            `
                UPDATE mailbox_jobs
                SET
                    status = 'executing',
                    attempt_count = attempt_count + 1,
                    leased_until_ms = ?2,
                    updated_at_ms = ?3,
                    started_at_ms = COALESCE(started_at_ms, ?3)
                WHERE id = ?1
                  AND status = 'pending'
                  AND next_attempt_at_ms <= ?3;
            `,
        )

        return this.db.transaction((clockMs: number, deadlineMs: number) => {
            const candidate = selectCandidate.get(clockMs)
            if (candidate === null || candidate === undefined) {
                return null
            }

            const result = claimJob.run(candidate.id, deadlineMs, clockMs)
            if (result.changes === 0) {
                return null
            }

            return this.getMailboxJob(candidate.id)
        })(nowMs, leaseUntilMs)
    }

    renewMailboxJobLease(jobId: number, leaseUntilMs: number, recordedAtMs: number): boolean {
        assertSafeInteger(jobId, "mailbox job id")
        assertSafeInteger(leaseUntilMs, "mailbox job leaseUntilMs")
        assertSafeInteger(recordedAtMs, "mailbox job recordedAtMs")

        const result = this.db
            .query(
                `
                    UPDATE mailbox_jobs
                    SET leased_until_ms = ?2,
                        updated_at_ms = ?3
                    WHERE id = ?1
                      AND status = 'executing';
                `,
            )
            .run(jobId, leaseUntilMs, recordedAtMs)

        return result.changes > 0
    }

    getMailboxJob(jobId: number): MailboxJobRecord | null {
        assertSafeInteger(jobId, "mailbox job id")
        const row = this.db
            .query<MailboxJobRow, [number]>(
                `
                    SELECT
                        id,
                        mailbox_key,
                        status,
                        attempt_count,
                        leased_until_ms,
                        next_attempt_at_ms,
                        last_error,
                        response_text,
                        final_text,
                        session_id,
                        created_at_ms,
                        updated_at_ms,
                        started_at_ms,
                        finished_at_ms
                    FROM mailbox_jobs
                    WHERE id = ?1;
                `,
            )
            .get(jobId)

        if (row === null || row === undefined) {
            return null
        }

        return mapMailboxJobs(this.db, [row])[0] ?? null
    }

    interruptMailboxJob(jobId: number, recordedAtMs: number): MailboxJobFinalizeResult {
        assertSafeInteger(jobId, "mailbox job id")
        assertSafeInteger(recordedAtMs, "mailbox job recordedAtMs")

        return this.db.transaction((targetJobId: number, nowMs: number) => {
            this.db
                .query(
                    `
                        UPDATE mailbox_jobs
                        SET
                            status = 'interrupted',
                            leased_until_ms = NULL,
                            last_error = NULL,
                            updated_at_ms = ?2,
                            finished_at_ms = ?2
                        WHERE id = ?1;
                    `,
                )
                .run(targetJobId, nowMs)

            return {
                status: "interrupted",
                cleanupEntries: deleteMailboxJobEntries(this.db, targetJobId),
            } satisfies MailboxJobFinalizeResult
        })(jobId, recordedAtMs)
    }

    completeMailboxJobExecution(input: CompleteMailboxJobExecutionInput): MailboxJobFinalizeResult {
        assertSafeInteger(input.jobId, "mailbox job id")
        assertSafeInteger(input.recordedAtMs, "mailbox job recordedAtMs")
        assertSafeInteger(input.deliveryRetryAtMs, "mailbox deliveryRetryAtMs")

        const updateJob = this.db.query(
            `
                UPDATE mailbox_jobs
                SET
                    status = ?2,
                    leased_until_ms = NULL,
                    last_error = NULL,
                    response_text = ?3,
                    final_text = ?4,
                    session_id = ?5,
                    updated_at_ms = ?6,
                    finished_at_ms = ?7
                WHERE id = ?1;
            `,
        )
        const insertDelivery = this.db.query(
            `
                INSERT INTO mailbox_deliveries (
                    job_id,
                    delivery_channel,
                    delivery_target,
                    delivery_topic,
                    delivery_mode,
                    stream_message_id,
                    preview_process_text,
                    preview_reasoning_text,
                    preview_tool_sections_json,
                    status,
                    attempt_count,
                    leased_until_ms,
                    next_attempt_at_ms,
                    last_error,
                    created_at_ms,
                    updated_at_ms,
                    delivered_at_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14, ?15, ?16);
            `,
        )

        return this.db.transaction((payload: CompleteMailboxJobExecutionInput) => {
            const finalText = normalizeStoredMailboxText(payload.finalText ?? "")
            const deliveries = dedupePreparedDeliveries(payload.deliveries)

            if (finalText === null || deliveries.length === 0) {
                updateJob.run(
                    payload.jobId,
                    "completed",
                    payload.responseText,
                    finalText,
                    payload.sessionId,
                    payload.recordedAtMs,
                    payload.recordedAtMs,
                )
                return {
                    status: "completed",
                    cleanupEntries: deleteMailboxJobEntries(this.db, payload.jobId),
                } satisfies MailboxJobFinalizeResult
            }

            for (const delivery of deliveries) {
                insertDelivery.run(
                    payload.jobId,
                    delivery.deliveryTarget.channel,
                    delivery.deliveryTarget.target,
                    normalizeKeyField(delivery.deliveryTarget.topic),
                    delivery.strategy.mode,
                    delivery.strategy.mode === "edit" ? delivery.strategy.messageId : null,
                    normalizeStoredMailboxText(delivery.previewContext?.processText ?? ""),
                    normalizeStoredMailboxText(delivery.previewContext?.reasoningText ?? ""),
                    encodeMailboxToolSections(delivery.previewContext?.toolSections ?? []),
                    "pending",
                    0,
                    payload.deliveryRetryAtMs,
                    null,
                    payload.recordedAtMs,
                    payload.recordedAtMs,
                    null,
                )
            }

            updateJob.run(
                payload.jobId,
                "ready_to_deliver",
                payload.responseText,
                finalText,
                payload.sessionId,
                payload.recordedAtMs,
                null,
            )
            return {
                status: "ready_to_deliver",
                cleanupEntries: [],
            } satisfies MailboxJobFinalizeResult
        })(input)
    }

    recordMailboxJobFailure(
        jobId: number,
        errorMessage: string,
        recordedAtMs: number,
        nextAttemptAtMs: number,
        maxAttempts: number,
    ): boolean {
        assertSafeInteger(jobId, "mailbox job id")
        assertSafeInteger(recordedAtMs, "mailbox job recordedAtMs")
        assertSafeInteger(nextAttemptAtMs, "mailbox job nextAttemptAtMs")
        assertSafeInteger(maxAttempts, "mailbox job maxAttempts")

        return this.db.transaction(
            (targetJobId: number, message: string, nowMs: number, retryAtMs: number, retryLimit: number) => {
                const row = this.db
                    .query<{ attempt_count: number }, [number]>(
                        "SELECT attempt_count FROM mailbox_jobs WHERE id = ?1 LIMIT 1;",
                    )
                    .get(targetJobId)
                if (row === null || row === undefined) {
                    throw new Error(`unknown mailbox job: ${targetJobId}`)
                }

                const quarantined = row.attempt_count >= retryLimit
                this.db
                    .query(
                        `
                            UPDATE mailbox_jobs
                            SET
                                status = ?2,
                                leased_until_ms = NULL,
                                next_attempt_at_ms = ?3,
                                last_error = ?4,
                                updated_at_ms = ?5,
                                finished_at_ms = ?6
                            WHERE id = ?1;
                        `,
                    )
                    .run(
                        targetJobId,
                        quarantined ? "quarantined" : "pending",
                        quarantined ? nowMs : retryAtMs,
                        message,
                        nowMs,
                        quarantined ? nowMs : null,
                    )

                return quarantined
            },
        )(jobId, errorMessage, recordedAtMs, nextAttemptAtMs, maxAttempts)
    }

    claimNextMailboxDelivery(nowMs: number, leaseUntilMs: number): MailboxDeliveryRecord | null {
        assertSafeInteger(nowMs, "mailbox delivery claim nowMs")
        assertSafeInteger(leaseUntilMs, "mailbox delivery leaseUntilMs")

        const selectCandidate = this.db.query<{ id: number }, [number]>(
            `
                SELECT id
                FROM mailbox_deliveries
                WHERE status = 'pending'
                  AND next_attempt_at_ms <= ?1
                ORDER BY created_at_ms ASC, id ASC
                LIMIT 1;
            `,
        )
        const claimDelivery = this.db.query(
            `
                UPDATE mailbox_deliveries
                SET
                    status = 'delivering',
                    attempt_count = attempt_count + 1,
                    leased_until_ms = ?2,
                    updated_at_ms = ?3
                WHERE id = ?1
                  AND status = 'pending'
                  AND next_attempt_at_ms <= ?3;
            `,
        )

        return this.db.transaction((clockMs: number, deadlineMs: number) => {
            const candidate = selectCandidate.get(clockMs)
            if (candidate === null || candidate === undefined) {
                return null
            }

            const result = claimDelivery.run(candidate.id, deadlineMs, clockMs)
            if (result.changes === 0) {
                return null
            }

            return this.getMailboxDelivery(candidate.id)
        })(nowMs, leaseUntilMs)
    }

    getMailboxDelivery(deliveryId: number): MailboxDeliveryRecord | null {
        assertSafeInteger(deliveryId, "mailbox delivery id")
        const row = this.db
            .query<MailboxDeliveryRow, [number]>(
                `
                    SELECT
                        id,
                        job_id,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        delivery_mode,
                        stream_message_id,
                        preview_process_text,
                        preview_reasoning_text,
                        preview_tool_sections_json,
                        status,
                        attempt_count,
                        leased_until_ms,
                        next_attempt_at_ms,
                        last_error,
                        created_at_ms,
                        updated_at_ms,
                        delivered_at_ms
                    FROM mailbox_deliveries
                    WHERE id = ?1;
                `,
            )
            .get(deliveryId)

        return row ? mapMailboxDeliveryRow(row) : null
    }

    private requireMailboxDelivery(deliveryId: number): MailboxDeliveryRecord {
        const delivery = this.getMailboxDelivery(deliveryId)
        if (delivery === null) {
            throw new Error(`unknown mailbox delivery: ${deliveryId}`)
        }

        return delivery
    }

    markMailboxDeliveryDelivered(deliveryId: number, recordedAtMs: number): MailboxJobFinalizeResult {
        assertSafeInteger(deliveryId, "mailbox delivery id")
        assertSafeInteger(recordedAtMs, "mailbox delivery recordedAtMs")

        return this.db.transaction((targetDeliveryId: number, nowMs: number) => {
            const delivery = this.requireMailboxDelivery(targetDeliveryId)
            this.db
                .query(
                    `
                        UPDATE mailbox_deliveries
                        SET
                            status = 'delivered',
                            leased_until_ms = NULL,
                            last_error = NULL,
                            updated_at_ms = ?2,
                            delivered_at_ms = ?2
                        WHERE id = ?1;
                    `,
                )
                .run(targetDeliveryId, nowMs)

            return finalizeMailboxJobAfterDelivery(this.db, delivery.jobId, nowMs)
        })(deliveryId, recordedAtMs)
    }

    recordMailboxDeliveryFailure(
        deliveryId: number,
        errorMessage: string,
        recordedAtMs: number,
        nextAttemptAtMs: number,
        maxAttempts: number,
    ): MailboxJobFinalizeResult {
        assertSafeInteger(deliveryId, "mailbox delivery id")
        assertSafeInteger(recordedAtMs, "mailbox delivery recordedAtMs")
        assertSafeInteger(nextAttemptAtMs, "mailbox delivery nextAttemptAtMs")
        assertSafeInteger(maxAttempts, "mailbox delivery maxAttempts")

        return this.db.transaction(
            (targetDeliveryId: number, message: string, nowMs: number, retryAtMs: number, retryLimit: number) => {
                const delivery = this.requireMailboxDelivery(targetDeliveryId)
                const quarantined = delivery.attemptCount >= retryLimit
                this.db
                    .query(
                        `
                            UPDATE mailbox_deliveries
                            SET
                                status = ?2,
                                leased_until_ms = NULL,
                                next_attempt_at_ms = ?3,
                                last_error = ?4,
                                updated_at_ms = ?5
                            WHERE id = ?1;
                        `,
                    )
                    .run(
                        targetDeliveryId,
                        quarantined ? "quarantined" : "pending",
                        quarantined ? nowMs : retryAtMs,
                        message,
                        nowMs,
                    )

                if (!quarantined) {
                    return {
                        status: "ready_to_deliver",
                        cleanupEntries: [],
                    } satisfies MailboxJobFinalizeResult
                }

                return finalizeMailboxJobAfterDelivery(this.db, delivery.jobId, nowMs)
            },
        )(deliveryId, errorMessage, recordedAtMs, nextAttemptAtMs, maxAttempts)
    }

    downgradeMailboxDeliveryToSend(deliveryId: number, errorMessage: string, recordedAtMs: number): void {
        assertSafeInteger(deliveryId, "mailbox delivery id")
        assertSafeInteger(recordedAtMs, "mailbox delivery recordedAtMs")

        this.db.transaction((targetDeliveryId: number, message: string, nowMs: number) => {
            const delivery = this.requireMailboxDelivery(targetDeliveryId)
            if (delivery.strategy.mode !== "edit") {
                return
            }

            this.db
                .query(
                    `
                        UPDATE mailbox_deliveries
                        SET
                            delivery_mode = 'send',
                            stream_message_id = NULL,
                            status = 'pending',
                            attempt_count = CASE
                                WHEN attempt_count > 0 THEN attempt_count - 1
                                ELSE 0
                            END,
                            leased_until_ms = NULL,
                            next_attempt_at_ms = ?2,
                            last_error = ?3,
                            updated_at_ms = ?2
                        WHERE id = ?1;
                    `,
                )
                .run(targetDeliveryId, nowMs, message)
        })(deliveryId, errorMessage, recordedAtMs)
    }

    requeueExpiredMailboxLeases(nowMs: number): {
        jobs: number
        deliveries: number
    } {
        assertSafeInteger(nowMs, "mailbox lease recovery nowMs")

        const resetJobs = this.db.query(
            `
                UPDATE mailbox_jobs
                SET
                    status = 'pending',
                    leased_until_ms = NULL,
                    next_attempt_at_ms = ?1,
                    updated_at_ms = ?2
                WHERE status = 'executing'
                  AND leased_until_ms IS NOT NULL
                  AND leased_until_ms <= ?3;
            `,
        )
        const resetDeliveries = this.db.query(
            `
                UPDATE mailbox_deliveries
                SET
                    status = 'pending',
                    leased_until_ms = NULL,
                    next_attempt_at_ms = ?1,
                    updated_at_ms = ?2
                WHERE status = 'delivering'
                  AND leased_until_ms IS NOT NULL
                  AND leased_until_ms <= ?3;
            `,
        )

        return this.db.transaction((clockMs: number) => {
            const jobs = resetJobs.run(clockMs, clockMs, clockMs).changes
            const deliveries = resetDeliveries.run(clockMs, clockMs, clockMs).changes
            return { jobs, deliveries }
        })(nowMs)
    }

    getMailboxJobFinalText(jobId: number): string | null {
        assertSafeInteger(jobId, "mailbox job id")
        const row = this.db
            .query<{ final_text: string | null }, [number]>("SELECT final_text FROM mailbox_jobs WHERE id = ?1;")
            .get(jobId)

        return row?.final_text ?? null
    }

    getMailboxJobResponseText(jobId: number): string | null {
        assertSafeInteger(jobId, "mailbox job id")
        const row = this.db
            .query<{ response_text: string | null }, [number]>("SELECT response_text FROM mailbox_jobs WHERE id = ?1;")
            .get(jobId)

        return row?.response_text ?? null
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
        if (input.runAtMs !== null) {
            assertSafeInteger(input.runAtMs, "cron run_at_ms")
        }

        this.db
            .query(
                `
                    INSERT INTO cron_jobs (
                        id,
                        kind,
                        schedule,
                        run_at_ms,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
                    ON CONFLICT(id) DO UPDATE SET
                        kind = excluded.kind,
                        schedule = excluded.schedule,
                        run_at_ms = excluded.run_at_ms,
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
                input.kind,
                encodeStoredSchedule(input.kind, input.schedule),
                input.runAtMs,
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
                        kind,
                        schedule,
                        run_at_ms,
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
                        kind,
                        schedule,
                        run_at_ms,
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
                        kind,
                        schedule,
                        run_at_ms,
                        prompt,
                        delivery_channel,
                        delivery_target,
                        delivery_topic,
                        enabled,
                        next_run_at_ms,
                        created_at_ms,
                        updated_at_ms
                    FROM cron_jobs
                    WHERE kind = 'cron' AND enabled = 1 AND next_run_at_ms <= ?1
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
                        kind,
                        schedule,
                        run_at_ms,
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

    setCronJobEnabled(id: string, enabled: boolean, recordedAtMs: number): void {
        assertSafeInteger(recordedAtMs, "cron recordedAtMs")

        this.db
            .query(
                `
                    UPDATE cron_jobs
                    SET enabled = ?2,
                        updated_at_ms = ?3
                    WHERE id = ?1;
                `,
            )
            .run(id, enabled ? 1 : 0, recordedAtMs)
    }

    listCronRuns(jobId: string, limit: number): CronRunRecord[] {
        assertSafeInteger(limit, "cron run limit")

        const rows = this.db
            .query<
                {
                    id: number
                    job_id: string
                    scheduled_for_ms: number
                    started_at_ms: number
                    finished_at_ms: number | null
                    status: CronRunStatus
                    response_text: string | null
                    error_message: string | null
                },
                [string, number]
            >(
                `
                    SELECT
                        id,
                        job_id,
                        scheduled_for_ms,
                        started_at_ms,
                        finished_at_ms,
                        status,
                        response_text,
                        error_message
                    FROM cron_runs
                    WHERE job_id = ?1
                    ORDER BY started_at_ms DESC, id DESC
                    LIMIT ?2;
                `,
            )
            .all(jobId, limit)

        return rows.map(
            (row): CronRunRecord => ({
                id: row.id,
                jobId: row.job_id,
                scheduledForMs: row.scheduled_for_ms,
                startedAtMs: row.started_at_ms,
                finishedAtMs: row.finished_at_ms,
                status: row.status,
                responseText: row.response_text,
                errorMessage: row.error_message,
            }),
        )
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
    kind: string
    run_at_ms: number | null
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
    ingress_state: string
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

type MailboxJobRow = {
    id: number
    mailbox_key: string
    status: string
    attempt_count: number
    leased_until_ms: number | null
    next_attempt_at_ms: number
    last_error: string | null
    response_text: string | null
    final_text: string | null
    session_id: string | null
    created_at_ms: number
    updated_at_ms: number
    started_at_ms: number | null
    finished_at_ms: number | null
}

type MailboxJobEntryRow = {
    job_id: number
    mailbox_entry_id: number
    ordinal: number
}

type MailboxDeliveryRow = {
    id: number
    job_id: number
    delivery_channel: string
    delivery_target: string
    delivery_topic: string
    delivery_mode: string
    stream_message_id: number | null
    preview_process_text: string | null
    preview_reasoning_text: string | null
    preview_tool_sections_json: string | null
    status: string
    attempt_count: number
    leased_until_ms: number | null
    next_attempt_at_ms: number
    last_error: string | null
    created_at_ms: number
    updated_at_ms: number
    delivered_at_ms: number | null
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

type PendingInteractionRow = {
    id: number
    request_id: string
    kind: string
    scope_kind: string
    scope_id: string
    delivery_channel: string
    delivery_target: string
    delivery_topic: string
    payload_json: string
    telegram_message_id: number | null
    created_at_ms: number
}

type TelegramMessageCleanupRow = {
    id: number
    kind: string
    chat_id: string
    message_id: number
    next_attempt_at_ms: number
    attempt_count: number
    leased_until_ms: number | null
    last_error: string | null
    created_at_ms: number
    updated_at_ms: number
}

type TelegramPreviewMessageRow = {
    chat_id: string
    message_id: number
    view_mode: string
    preview_page: number
    tools_page: number
    process_text: string | null
    reasoning_text: string | null
    answer_text: string | null
    tool_sections_json: string | null
    created_at_ms: number
    updated_at_ms: number
}

type PendingInteractionPayload =
    | Pick<GatewayQuestionRequest, "kind" | "questions">
    | Pick<GatewayPermissionRequest, "kind" | "permission" | "patterns" | "metadata" | "always" | "tool">
    | Pick<GatewayInflightPolicyRequest, "kind" | "mailboxKey">

function mapCronJobRow(row: CronJobRow): CronJobRecord {
    const kind = parseScheduleJobKind(row.kind)
    return {
        id: row.id,
        kind,
        schedule: kind === "cron" ? row.schedule : null,
        runAtMs: row.run_at_ms,
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

function parseScheduleJobKind(value: string): ScheduleJobKind {
    switch (value) {
        case "cron":
        case "once":
            return value
        default:
            throw new Error(`stored schedule job kind is invalid: ${value}`)
    }
}

function encodeStoredSchedule(kind: ScheduleJobKind, schedule: string | null): string {
    if (kind === "once") {
        return "@once"
    }

    if (schedule === null) {
        throw new Error("cron schedule must not be null")
    }

    return schedule
}

function mapMailboxEntryRow(row: MailboxEntryRow, attachments: MailboxEntryAttachmentRecord[]): MailboxEntryRecord {
    return {
        id: row.id,
        mailboxKey: row.mailbox_key,
        ingressState: parseMailboxEntryIngressState(row.ingress_state),
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

function parseMailboxEntryIngressState(value: string): MailboxEntryIngressState {
    switch (value) {
        case "ready":
        case "held_for_inflight_policy":
            return value
        default:
            throw new Error(`stored mailbox entry ingress state is invalid: ${value}`)
    }
}

function listMailboxAttachments(
    db: SqliteDatabaseLike,
    entryIds: number[],
): Map<number, MailboxEntryAttachmentRecord[]> {
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

function mapMailboxJobs(db: SqliteDatabaseLike, rows: MailboxJobRow[]): MailboxJobRecord[] {
    if (rows.length === 0) {
        return []
    }

    const jobIds = rows.map((row) => row.id)
    const attachmentsByEntryId = listMailboxAttachments(db, listMailboxJobEntryIds(db, jobIds))
    const entriesByJobId = listMailboxJobEntries(db, jobIds, attachmentsByEntryId)

    return rows.map((row) => ({
        id: row.id,
        mailboxKey: row.mailbox_key,
        status: parseMailboxJobStatus(row.status),
        attemptCount: row.attempt_count,
        leasedUntilMs: row.leased_until_ms,
        nextAttemptAtMs: row.next_attempt_at_ms,
        lastError: row.last_error,
        responseText: row.response_text,
        finalText: row.final_text,
        sessionId: row.session_id,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
        startedAtMs: row.started_at_ms,
        finishedAtMs: row.finished_at_ms,
        entries: entriesByJobId.get(row.id) ?? [],
    }))
}

function listMailboxJobEntryIds(db: SqliteDatabaseLike, jobIds: number[]): number[] {
    if (jobIds.length === 0) {
        return []
    }

    for (const jobId of jobIds) {
        assertSafeInteger(jobId, "mailbox job id")
    }
    const placeholders = jobIds.map((_, index) => `?${index + 1}`).join(", ")
    const rows = db
        .query<MailboxJobEntryRow, number[]>(
            `
                SELECT job_id, mailbox_entry_id, ordinal
                FROM mailbox_job_entries
                WHERE job_id IN (${placeholders})
                ORDER BY job_id ASC, ordinal ASC;
            `,
        )
        .all(...jobIds)

    return rows.map((row) => row.mailbox_entry_id)
}

function listMailboxJobEntries(
    db: SqliteDatabaseLike,
    jobIds: number[],
    attachmentsByEntryId: Map<number, MailboxEntryAttachmentRecord[]>,
): Map<number, MailboxEntryRecord[]> {
    if (jobIds.length === 0) {
        return new Map()
    }

    for (const jobId of jobIds) {
        assertSafeInteger(jobId, "mailbox job id")
    }
    const placeholders = jobIds.map((_, index) => `?${index + 1}`).join(", ")
    const rows = db
        .query<MailboxJobEntryRow & MailboxEntryRow, number[]>(
            `
                SELECT
                    job_entry.job_id,
                    job_entry.mailbox_entry_id,
                    job_entry.ordinal,
                    entry.id,
                    entry.mailbox_key,
                    entry.ingress_state,
                    entry.source_kind,
                    entry.external_id,
                    entry.sender,
                    entry.body,
                    entry.reply_channel,
                    entry.reply_target,
                    entry.reply_topic,
                    entry.created_at_ms
                FROM mailbox_job_entries AS job_entry
                JOIN mailbox_entries AS entry
                  ON entry.id = job_entry.mailbox_entry_id
                WHERE job_entry.job_id IN (${placeholders})
                ORDER BY job_entry.job_id ASC, job_entry.ordinal ASC;
            `,
        )
        .all(...jobIds)

    const entries = new Map<number, MailboxEntryRecord[]>()
    for (const row of rows) {
        const records = entries.get(row.job_id) ?? []
        records.push(
            mapMailboxEntryRow(
                {
                    id: row.id,
                    mailbox_key: row.mailbox_key,
                    ingress_state: row.ingress_state,
                    source_kind: row.source_kind,
                    external_id: row.external_id,
                    sender: row.sender,
                    body: row.body,
                    reply_channel: row.reply_channel,
                    reply_target: row.reply_target,
                    reply_topic: row.reply_topic,
                    created_at_ms: row.created_at_ms,
                },
                attachmentsByEntryId.get(row.id) ?? [],
            ),
        )
        entries.set(row.job_id, records)
    }

    return entries
}

function parseMailboxJobStatus(value: string): MailboxJobStatus {
    switch (value) {
        case "pending":
        case "executing":
        case "ready_to_deliver":
        case "completed":
        case "interrupted":
        case "quarantined":
            return value
        default:
            throw new Error(`stored mailbox job status is invalid: ${value}`)
    }
}

function parseMailboxDeliveryStatus(value: string): MailboxDeliveryStatus {
    switch (value) {
        case "pending":
        case "delivering":
        case "delivered":
        case "quarantined":
            return value
        default:
            throw new Error(`stored mailbox delivery status is invalid: ${value}`)
    }
}

function parseMailboxDeliveryStrategy(
    row: Pick<MailboxDeliveryRow, "delivery_mode" | "stream_message_id">,
): BindingDeferredDeliveryStrategy {
    switch (row.delivery_mode) {
        case "send":
            return {
                mode: "send",
            }
        case "edit": {
            const messageId = row.stream_message_id
            if (messageId === null || !Number.isSafeInteger(messageId) || messageId <= 0) {
                throw new Error("stored edit-mode mailbox delivery is missing a valid message id")
            }

            return {
                mode: "edit",
                messageId,
            }
        }
        default:
            throw new Error(`stored mailbox delivery mode is invalid: ${row.delivery_mode}`)
    }
}

function mapMailboxDeliveryRow(row: MailboxDeliveryRow): MailboxDeliveryRecord {
    return {
        id: row.id,
        jobId: row.job_id,
        deliveryTarget: {
            channel: row.delivery_channel,
            target: row.delivery_target,
            topic: normalizeStoredKeyField(row.delivery_topic),
        },
        strategy: parseMailboxDeliveryStrategy(row),
        previewContext: parseMailboxPreviewContext(row),
        status: parseMailboxDeliveryStatus(row.status),
        attemptCount: row.attempt_count,
        leasedUntilMs: row.leased_until_ms,
        nextAttemptAtMs: row.next_attempt_at_ms,
        lastError: row.last_error,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
        deliveredAtMs: row.delivered_at_ms,
    }
}

function parseMailboxPreviewContext(
    row: Pick<MailboxDeliveryRow, "preview_process_text" | "preview_reasoning_text" | "preview_tool_sections_json">,
): BindingDeferredPreviewContext | null {
    const processText = normalizeStoredMailboxText(row.preview_process_text ?? "")
    const reasoningText = normalizeStoredMailboxText(row.preview_reasoning_text ?? "")
    const toolSections = parseMailboxToolSections(row.preview_tool_sections_json)
    if (processText === null && reasoningText === null && toolSections.length === 0) {
        return null
    }

    return {
        processText,
        reasoningText,
        toolSections,
    }
}

function encodeMailboxToolSections(
    toolSections: NonNullable<BindingDeferredPreviewContext["toolSections"]>,
): string | null {
    if (toolSections.length === 0) {
        return null
    }

    return JSON.stringify(toolSections)
}

function parseMailboxToolSections(value: string | null): NonNullable<BindingDeferredPreviewContext["toolSections"]> {
    if (value === null || value.trim().length === 0) {
        return []
    }

    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
        throw new Error("mailbox preview tool sections must be an array")
    }

    return parsed.map((entry, index) => parseMailboxToolSection(entry, index))
}

function parseMailboxToolSection(
    value: unknown,
    index: number,
): NonNullable<BindingDeferredPreviewContext["toolSections"]>[number] {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`mailbox preview tool section ${index} must be an object`)
    }

    return {
        callId: readRequiredStoredObjectStringField(value, "callId", `toolSections[${index}]`),
        toolName: readRequiredStoredObjectStringField(value, "toolName", `toolSections[${index}]`),
        status: readMailboxToolStatus(value, index),
        title: readOptionalStoredObjectStringField(value, "title", `toolSections[${index}]`),
        inputText: readOptionalStoredObjectStringField(value, "inputText", `toolSections[${index}]`),
        outputText: readOptionalStoredObjectStringField(value, "outputText", `toolSections[${index}]`),
        errorText: readOptionalStoredObjectStringField(value, "errorText", `toolSections[${index}]`),
    }
}

function readMailboxToolStatus(
    value: object,
    index: number,
): NonNullable<BindingDeferredPreviewContext["toolSections"]>[number]["status"] {
    const status = readRequiredStoredObjectStringField(value, "status", `toolSections[${index}]`)
    if (status === "pending" || status === "running" || status === "completed" || status === "error") {
        return status
    }

    throw new Error(`toolSections[${index}].status must be one of pending, running, completed, error`)
}

function readRequiredStoredObjectStringField(value: object, key: string, field: string): string {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error(`stored field ${field}.${key} is invalid`)
    }

    return raw
}

function readOptionalStoredObjectStringField(value: object, key: string, field: string): string | null {
    const raw = (value as Record<string, unknown>)[key]
    if (raw === null || raw === undefined) {
        return null
    }

    if (typeof raw !== "string") {
        throw new Error(`stored field ${field}.${key} is invalid`)
    }

    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : raw
}

function deleteMailboxJobEntries(db: SqliteDatabaseLike, jobId: number): MailboxEntryRecord[] {
    assertSafeInteger(jobId, "mailbox job id")
    const rows = db
        .query<MailboxEntryRow, [number]>(
            `
                SELECT
                    entry.id,
                    entry.mailbox_key,
                    entry.ingress_state,
                    entry.source_kind,
                    entry.external_id,
                    entry.sender,
                    entry.body,
                    entry.reply_channel,
                    entry.reply_target,
                    entry.reply_topic,
                    entry.created_at_ms
                FROM mailbox_job_entries AS job_entry
                JOIN mailbox_entries AS entry
                  ON entry.id = job_entry.mailbox_entry_id
                WHERE job_entry.job_id = ?1
                ORDER BY job_entry.ordinal ASC;
            `,
        )
        .all(jobId)
    const attachments = listMailboxAttachments(
        db,
        rows.map((row) => row.id),
    )
    const entries = rows.map((row) => mapMailboxEntryRow(row, attachments.get(row.id) ?? []))

    if (rows.length > 0) {
        const ids = rows.map((row) => row.id)
        const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ")
        db.query(`DELETE FROM mailbox_entries WHERE id IN (${placeholders});`).run(...ids)
    }

    return entries
}

function finalizeMailboxJobAfterDelivery(
    db: SqliteDatabaseLike,
    jobId: number,
    recordedAtMs: number,
): MailboxJobFinalizeResult {
    const active = db
        .query<{ total: number }, [number]>(
            `
                SELECT COUNT(*) AS total
                FROM mailbox_deliveries
                WHERE job_id = ?1
                  AND status IN ('pending', 'delivering');
            `,
        )
        .get(jobId)

    if ((active?.total ?? 0) > 0) {
        return {
            status: "ready_to_deliver",
            cleanupEntries: [],
        }
    }

    const quarantined = db
        .query<{ total: number }, [number]>(
            `
                SELECT COUNT(*) AS total
                FROM mailbox_deliveries
                WHERE job_id = ?1
                  AND status = 'quarantined';
            `,
        )
        .get(jobId)

    if ((quarantined?.total ?? 0) > 0) {
        db.query(
            `
                UPDATE mailbox_jobs
                SET
                    status = 'quarantined',
                    leased_until_ms = NULL,
                    updated_at_ms = ?2,
                    finished_at_ms = ?2
                WHERE id = ?1;
            `,
        ).run(jobId, recordedAtMs)
        return {
            status: "quarantined",
            cleanupEntries: [],
        }
    }

    db.query(
        `
            UPDATE mailbox_jobs
            SET
                status = 'completed',
                leased_until_ms = NULL,
                updated_at_ms = ?2,
                finished_at_ms = ?2
            WHERE id = ?1;
        `,
    ).run(jobId, recordedAtMs)

    return {
        status: "completed",
        cleanupEntries: deleteMailboxJobEntries(db, jobId),
    }
}

function dedupePreparedDeliveries(deliveries: MailboxPreparedDelivery[]): MailboxPreparedDelivery[] {
    const deduped = new Map<string, MailboxPreparedDelivery>()
    for (const delivery of deliveries) {
        const key = `${delivery.deliveryTarget.channel}:${delivery.deliveryTarget.target}:${delivery.deliveryTarget.topic ?? ""}`
        deduped.set(key, delivery)
    }

    return [...deduped.values()]
}

function mapSessionReplyTargetRow(row: SessionReplyTargetRow): BindingDeliveryTarget {
    return {
        channel: row.delivery_channel,
        target: row.delivery_target,
        topic: normalizeStoredKeyField(row.delivery_topic),
    }
}

function mapPendingInteractionRow(row: PendingInteractionRow): PendingInteractionRecord {
    const payload = parsePendingInteractionPayload(row.kind, row.payload_json)
    const scope = {
        kind: parsePendingInteractionScopeKind(row.scope_kind),
        id: row.scope_id,
    } satisfies GatewayInteractionScope
    const request = mapPendingInteractionRequest(scope, row.request_id, payload)
    return {
        ...request,
        scope,
        deliveryTarget: {
            channel: row.delivery_channel,
            target: row.delivery_target,
            topic: normalizeStoredKeyField(row.delivery_topic),
        },
        telegramMessageId: row.telegram_message_id,
        createdAtMs: row.created_at_ms,
    }
}

function mapPendingInteractionRequest(
    scope: GatewayInteractionScope,
    requestId: string,
    payload: PendingInteractionPayload,
): GatewayInteractionRequest {
    switch (payload.kind) {
        case "question":
            assertSessionScopedInteraction(scope, payload.kind)
            return {
                kind: payload.kind,
                requestId,
                sessionId: scope.id,
                questions: payload.questions,
            }
        case "permission":
            assertSessionScopedInteraction(scope, payload.kind)
            return {
                kind: payload.kind,
                requestId,
                sessionId: scope.id,
                permission: payload.permission,
                patterns: payload.patterns,
                metadata: payload.metadata,
                always: payload.always,
                tool: payload.tool,
            }
        case "inflight_policy":
            if (scope.kind !== "mailbox" || scope.id !== payload.mailboxKey) {
                throw new Error("stored pending inflight policy scope is invalid")
            }
            return {
                kind: payload.kind,
                requestId,
                mailboxKey: payload.mailboxKey,
            }
    }
}

function assertSessionScopedInteraction(
    scope: GatewayInteractionScope,
    kind: string,
): asserts scope is {
    kind: "session"
    id: string
} {
    if (scope.kind !== "session") {
        throw new Error(`stored pending ${kind} interaction must be session-scoped`)
    }
}

function parsePendingInteractionScopeKind(value: string): GatewayInteractionScope["kind"] {
    switch (value) {
        case "session":
        case "mailbox":
            return value
        default:
            throw new Error(`stored pending interaction scope kind is invalid: ${value}`)
    }
}

function mapTelegramCleanupRow(row: TelegramMessageCleanupRow): TelegramMessageCleanupRecord {
    return {
        id: row.id,
        kind: parseTelegramCleanupKind(row.kind),
        chatId: row.chat_id,
        messageId: row.message_id,
        nextAttemptAtMs: row.next_attempt_at_ms,
        attemptCount: row.attempt_count,
        leasedUntilMs: row.leased_until_ms,
        lastError: row.last_error,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
    }
}

function mapTelegramPreviewMessageRow(row: TelegramPreviewMessageRow): TelegramPreviewMessageRecord {
    return {
        chatId: row.chat_id,
        messageId: row.message_id,
        viewMode: parseTelegramPreviewViewMode(row.view_mode),
        previewPage: row.preview_page,
        toolsPage: row.tools_page,
        processText: normalizeStoredMailboxText(row.process_text ?? ""),
        reasoningText: normalizeStoredMailboxText(row.reasoning_text ?? ""),
        answerText: normalizeStoredMailboxText(row.answer_text ?? ""),
        toolSections: parseMailboxToolSections(row.tool_sections_json),
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
    }
}

function parseTelegramCleanupKind(value: string): TelegramMessageCleanupKind {
    switch (value) {
        case "interaction":
        case "tool_activity":
            return value
        default:
            throw new Error(`stored telegram cleanup kind is invalid: ${value}`)
    }
}

function parseTelegramPreviewViewMode(value: string): TelegramPreviewViewMode {
    switch (value) {
        case "preview":
        case "tools":
            return value
        default:
            throw new Error(`stored telegram preview view mode is invalid: ${value}`)
    }
}

function encodePendingInteractionPayload(request: GatewayInteractionRequest): string {
    switch (request.kind) {
        case "question":
            return JSON.stringify({
                questions: request.questions,
            })
        case "permission":
            return JSON.stringify({
                permission: request.permission,
                patterns: request.patterns,
                metadata: request.metadata,
                always: request.always,
                tool: request.tool,
            })
        case "inflight_policy":
            return JSON.stringify({
                mailboxKey: request.mailboxKey,
            })
    }
}

function parsePendingInteractionPayload(kind: string, value: string): PendingInteractionPayload {
    switch (kind) {
        case "question":
            return {
                kind,
                questions: parsePendingQuestions(value),
            }
        case "permission":
            return {
                kind,
                ...parsePendingPermission(value),
            }
        case "inflight_policy":
            return {
                kind,
                mailboxKey: parsePendingInflightPolicy(value),
            }
        default:
            throw new Error(`stored pending interaction kind is invalid: ${kind}`)
    }
}

function parsePendingInflightPolicy(value: string): string {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === "string" && parsed.trim().length > 0) {
        return parsed
    }

    if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as Record<string, unknown>
        if (typeof record.mailboxKey === "string" && record.mailboxKey.trim().length > 0) {
            return record.mailboxKey
        }
    }

    throw new Error("stored pending inflight policy payload is invalid")
}

function parsePendingQuestions(value: string): GatewayQuestionInfo[] {
    const parsed = JSON.parse(value) as unknown
    const questions = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "questions" in parsed && Array.isArray(parsed.questions)
          ? parsed.questions
          : null
    if (questions === null) {
        throw new Error("stored pending question payload is invalid")
    }

    return questions.map((question, index) => {
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

function parsePendingPermission(value: string): Omit<GatewayPermissionRequest, "kind" | "requestId" | "sessionId"> {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("stored pending permission payload is invalid")
    }

    const permission = readRequiredStringField(parsed, "permission")
    const patterns = readStringArrayField(parsed, "patterns")
    const always = readStringArrayField(parsed, "always")
    const metadataValue = readObjectField(parsed, "metadata")
    const toolValue = readOptionalObjectField(parsed, "tool")

    return {
        permission,
        patterns,
        metadata: metadataValue,
        always,
        tool:
            toolValue === null
                ? null
                : {
                      messageId: readRequiredStringField(toolValue, "messageId"),
                      callId: readRequiredStringField(toolValue, "callId"),
                  },
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

function readStringArrayField(value: object, field: string): string[] {
    const raw = readArrayField(value, field)
    if (!raw.every((entry) => typeof entry === "string")) {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw
}

function readObjectField(value: object, field: string): Record<string, unknown> {
    const raw = (value as Record<string, unknown>)[field]
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw as Record<string, unknown>
}

function readOptionalObjectField(value: object, field: string): Record<string, unknown> | null {
    const raw = (value as Record<string, unknown>)[field]
    if (raw === undefined || raw === null) {
        return null
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`stored field ${field} is invalid`)
    }

    return raw as Record<string, unknown>
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

    const { openRuntimeSqliteDatabase } = await import("./database")
    const db = await openRuntimeSqliteDatabase(path)
    migrateGatewayDatabase(db)

    return new SqliteStore(db)
}
