import type {
    BindingCronJobSpec,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingPreparedExecution,
    BindingRuntimeReport,
    GatewayBindingModule,
} from "../binding"
import type { GatewayTextDelivery, TextDeliverySession } from "../delivery/text"
import type { GatewayOpencodeHost } from "../host/opencode"
import { createMailboxPromptIds } from "../opencode/message-ids"
import type { MailboxEntryRecord, RuntimeJournalEntry, SqliteStore } from "../store/sqlite"

const DEFAULT_FLUSH_INTERVAL_MS = 400

export class GatewayExecutor {
    constructor(
        private readonly module: GatewayBindingModule,
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeHostLike,
        private readonly delivery: GatewayTextDeliveryLike,
        private readonly logger: BindingLoggerHost,
    ) {}

    prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
        return this.module.prepareInboundExecution(message)
    }

    async handleInboundMessage(message: BindingInboundMessage): Promise<BindingRuntimeReport> {
        const prepared = this.prepareInboundMessage(message)
        const syntheticEntry = {
            id: Date.now(),
            mailboxKey: prepared.conversationKey,
            sourceKind: "direct_runtime",
            externalId: `direct:${Date.now()}`,
            sender: normalizeRequiredField(message.sender, "message sender"),
            body: message.body,
            replyChannel: message.deliveryTarget.channel,
            replyTarget: message.deliveryTarget.target,
            replyTopic: message.deliveryTarget.topic,
            createdAtMs: Date.now(),
        } satisfies MailboxEntryRecord

        return await this.executeMailboxEntries([syntheticEntry])
    }

    async executeMailboxEntries(entries: MailboxEntryRecord[]): Promise<BindingRuntimeReport> {
        if (entries.length === 0) {
            throw new Error("mailbox execution requires at least one entry")
        }

        const preparedEntries = entries.map((entry) => {
            const message = mailboxEntryToInboundMessage(entry)
            return {
                entry,
                message,
                prepared: this.prepareInboundMessage(message),
            }
        })

        const conversationKey = preparedEntries[0].prepared.conversationKey
        if (preparedEntries.some((entry) => entry.prepared.conversationKey !== conversationKey)) {
            throw new Error("mailbox batch contains mixed conversation keys")
        }

        const recordedAtMs = Date.now()
        this.logger.log("info", "handling inbound gateway message")
        this.store.appendJournal(
            createJournalEntry("mailbox_flush", recordedAtMs, conversationKey, {
                entryIds: preparedEntries.map((entry) => entry.entry.id),
                count: preparedEntries.length,
            }),
        )

        for (const entry of preparedEntries) {
            this.store.appendJournal(
                createJournalEntry("inbound_message", entry.entry.createdAtMs, conversationKey, {
                    deliveryTarget: entry.prepared.replyTarget,
                    sender: entry.message.sender,
                    body: entry.prepared.prompt,
                }),
            )
        }

        return await this.executePreparedEntries(preparedEntries, recordedAtMs)
    }

    async dispatchCronJob(job: BindingCronJobSpec): Promise<BindingRuntimeReport> {
        const prepared = this.module.prepareCronExecution(job)
        const id = normalizeRequiredField(job.id, "cron job id")
        const schedule = normalizeRequiredField(job.schedule, "cron schedule")
        const recordedAtMs = Date.now()

        this.logger.log("info", "dispatching cron gateway job")
        this.store.appendJournal(
            createJournalEntry("cron_dispatch", recordedAtMs, prepared.conversationKey, {
                id,
                schedule,
                prompt: prepared.prompt,
                deliveryChannel: prepared.replyTarget?.channel ?? null,
                deliveryTarget: prepared.replyTarget?.target ?? null,
                deliveryTopic: prepared.replyTarget?.topic ?? null,
            }),
        )

        return await this.executePreparedEntries(
            [
                {
                    entry: null,
                    message: null,
                    prepared,
                },
            ],
            recordedAtMs,
        )
    }

    private async executePreparedEntries(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
    ): Promise<BindingRuntimeReport> {
        const conversationKey = entries[0].prepared.conversationKey
        const persistedSessionId = this.store.getSessionBinding(conversationKey)
        const replyTargets = dedupeReplyTargets(
            entries.flatMap((entry) => (entry.prepared.replyTarget === null ? [] : [entry.prepared.replyTarget])),
        )
        const [deliverySession] =
            replyTargets.length === 0 ? [null] : await this.delivery.openMany(replyTargets, "auto")
        const promptResult = await this.executePromptWithRecovery(entries, persistedSessionId, deliverySession)

        this.store.putSessionBinding(conversationKey, promptResult.sessionId, recordedAtMs)

        let delivered = false
        if (deliverySession !== null) {
            delivered = await deliverySession.finish(promptResult.finalText)
            if (promptResult.finalText !== null) {
                this.store.appendJournal(
                    createJournalEntry("delivery", recordedAtMs, conversationKey, {
                        deliveryTargets: replyTargets,
                        body: promptResult.finalText,
                    }),
                )
            }
        }

        return {
            conversationKey,
            responseText: promptResult.responseText,
            delivered,
            recordedAtMs: BigInt(recordedAtMs),
        }
    }

    private async executePromptWithRecovery(
        entries: PreparedMailboxEntry[],
        persistedSessionId: string | null,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<PromptExecutionResult> {
        const conversationKey = entries[0].prepared.conversationKey
        const sessionId = await this.opencode.ensureSession(conversationKey, persistedSessionId)

        try {
            await this.opencode.waitUntilSessionIdle(sessionId)
            return await this.executePrompt(entries, sessionId, deliverySession)
        } catch (error) {
            if (persistedSessionId === null || !isMissingSessionBindingError(error)) {
                throw error
            }

            this.logger.log(
                "warn",
                `stale opencode session binding detected for ${conversationKey}; recreating session`,
            )
            this.store.deleteSessionBinding(conversationKey)

            const freshSessionId = await this.opencode.ensureSession(conversationKey, null)
            await this.opencode.waitUntilSessionIdle(freshSessionId)
            return await this.executePrompt(entries, freshSessionId, deliverySession)
        }
    }

    private async executePrompt(
        entries: PreparedMailboxEntry[],
        sessionId: string,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<PromptExecutionResult> {
        const lastEntry = entries[entries.length - 1]
        const execution =
            deliverySession?.mode === "progressive"
                ? this.module.ExecutionHandle.progressive(lastEntry.prepared, sessionId, DEFAULT_FLUSH_INTERVAL_MS)
                : this.module.ExecutionHandle.oneshot(lastEntry.prepared, sessionId, DEFAULT_FLUSH_INTERVAL_MS)

        try {
            for (const entry of entries.slice(0, -1)) {
                if (entry.entry === null) {
                    throw new Error("synthetic execution batches cannot append intermediate prompts")
                }

                await this.opencode.appendPrompt(
                    sessionId,
                    entry.prepared.prompt,
                    createMailboxPromptIds(entry.entry.id),
                )
            }

            const responseText = await this.opencode.promptSessionWithSnapshots(
                sessionId,
                lastEntry.prepared.prompt,
                createPromptIds(lastEntry.entry, lastEntry.prepared.conversationKey),
                execution,
                deliverySession?.mode === "progressive"
                    ? async (snapshot) => {
                          await deliverySession.preview(snapshot)
                      }
                    : null,
            )
            const finalDirective = execution.finish(responseText, monotonicNowMs())

            return {
                sessionId,
                responseText,
                finalText: finalDirective.kind === "final" ? finalDirective.text : null,
            }
        } finally {
            execution.free?.()
        }
    }
}

export type GatewayExecutorLike = Pick<
    GatewayExecutor,
    "handleInboundMessage" | "dispatchCronJob" | "executeMailboxEntries" | "prepareInboundMessage"
>

type PromptExecutionResult = {
    sessionId: string
    responseText: string
    finalText: string | null
}

type PreparedMailboxEntry = {
    entry: MailboxEntryRecord | null
    message: BindingInboundMessage | null
    prepared: BindingPreparedExecution
}

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "openMany">
type GatewayOpencodeHostLike = Pick<
    GatewayOpencodeHost,
    "ensureSession" | "waitUntilSessionIdle" | "appendPrompt" | "promptSessionWithSnapshots"
>
type TextDeliverySessionLike = Pick<TextDeliverySession, "mode" | "preview" | "finish">

function createJournalEntry(
    kind: RuntimeJournalEntry["kind"],
    recordedAtMs: number,
    conversationKey: string | null,
    payload: unknown,
): RuntimeJournalEntry {
    return {
        kind,
        recordedAtMs,
        conversationKey,
        payload,
    }
}

function mailboxEntryToInboundMessage(entry: MailboxEntryRecord): BindingInboundMessage {
    if (entry.replyChannel === null || entry.replyTarget === null) {
        throw new Error("mailbox entries without a reply target are not supported on the inbound path")
    }

    return {
        mailboxKey: entry.mailboxKey,
        sender: entry.sender,
        body: entry.body,
        deliveryTarget: {
            channel: entry.replyChannel,
            target: entry.replyTarget,
            topic: entry.replyTopic,
        },
    }
}

function createPromptIds(entry: MailboxEntryRecord | null, conversationKey: string) {
    if (entry !== null) {
        return createMailboxPromptIds(entry.id)
    }

    const now = Date.now()
    return {
        messageId: `msg_gateway_${sanitizeIdentifier(conversationKey)}_${now}`,
        textPartId: `prt_gateway_${sanitizeIdentifier(conversationKey)}_${now}`,
    }
}

function dedupeReplyTargets(
    targets: BindingPreparedExecution["replyTarget"][],
): NonNullable<BindingPreparedExecution["replyTarget"]>[] {
    const seen = new Set<string>()
    const unique: NonNullable<BindingPreparedExecution["replyTarget"]>[] = []

    for (const target of targets) {
        if (target === null) {
            continue
        }

        const key = `${target.channel}:${target.target}:${target.topic ?? ""}`
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        unique.push(target)
    }

    return unique
}

function normalizeRequiredField(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function isMissingSessionBindingError(error: unknown): boolean {
    return containsMissingSessionBinding(error, 0)
}

function containsMissingSessionBinding(value: unknown, depth: number): boolean {
    if (depth > 6) {
        return false
    }

    if (typeof value === "string") {
        return value.includes("Session not found:")
    }

    if (typeof value !== "object" || value === null) {
        return false
    }

    for (const key of Object.getOwnPropertyNames(value)) {
        const nested = (value as Record<string, unknown>)[key]
        if (containsMissingSessionBinding(nested, depth + 1)) {
            return true
        }
    }

    return false
}

function monotonicNowMs(): number {
    return Math.trunc(performance.now())
}

function sanitizeIdentifier(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]+/g, "_")
}
