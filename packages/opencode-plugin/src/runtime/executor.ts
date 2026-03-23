import type {
    BindingCronJobSpec,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingPreparedExecution,
    BindingRuntimeReport,
    GatewayBindingModule,
} from "../binding"
import type { GatewayTextDelivery, TextDeliverySession } from "../delivery/text"
import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { OpencodeEventHub } from "../opencode/events"
import type { MailboxEntryRecord, RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { type PromptExecutionResult, runOpencodeDriver } from "./opencode-runner"

export class GatewayExecutor {
    constructor(
        private readonly module: GatewayBindingModule,
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeRuntimeLike,
        private readonly events: OpencodeEventHub,
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
            text: message.text,
            attachments: withAttachmentOrdinals(message.attachments),
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
                    text: entry.message.text,
                    attachments: entry.message.attachments,
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
                promptParts: prepared.promptParts,
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
        const promptResult = await this.executeDriver(
            entries,
            recordedAtMs,
            persistedSessionId,
            deliverySession,
            replyTargets,
        )

        this.store.putSessionBindingIfUnchanged(
            conversationKey,
            persistedSessionId,
            promptResult.sessionId,
            recordedAtMs,
        )

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

    private async executeDriver(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
        persistedSessionId: string | null,
        deliverySession: TextDeliverySessionLike | null,
        replyTargets: NonNullable<BindingPreparedExecution["replyTarget"]>[],
    ): Promise<PromptExecutionResult> {
        return await runOpencodeDriver({
            module: this.module,
            opencode: this.opencode,
            events: this.events,
            conversationKey: entries[0].prepared.conversationKey,
            persistedSessionId,
            deliverySession,
            prompts: entries.map((entry, index) => ({
                promptKey: createPromptKey(entry, recordedAtMs, index),
                parts: entry.prepared.promptParts,
            })),
            onSessionAvailable: async (sessionId) => {
                this.store.replaceSessionReplyTargets({
                    sessionId,
                    conversationKey: entries[0].prepared.conversationKey,
                    targets: replyTargets,
                    recordedAtMs,
                })
            },
        })
    }
}

export type GatewayExecutorLike = Pick<
    GatewayExecutor,
    "handleInboundMessage" | "dispatchCronJob" | "executeMailboxEntries" | "prepareInboundMessage"
>

type PreparedMailboxEntry = {
    entry: MailboxEntryRecord | null
    message: BindingInboundMessage | null
    prepared: BindingPreparedExecution
}

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "openMany">
type GatewayOpencodeRuntimeLike = Pick<OpencodeSdkAdapter, "execute">
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
    return {
        deliveryTarget: {
            channel: normalizeRequiredField(entry.replyChannel ?? "", "mailbox reply channel"),
            target: normalizeRequiredField(entry.replyTarget ?? "", "mailbox reply target"),
            topic: entry.replyTopic,
        },
        sender: entry.sender,
        text: entry.text,
        attachments: entry.attachments,
        mailboxKey: entry.mailboxKey,
    }
}

function dedupeReplyTargets(
    targets: NonNullable<BindingPreparedExecution["replyTarget"]>[],
): NonNullable<BindingPreparedExecution["replyTarget"]>[] {
    const seen = new Set<string>()
    return targets.filter((target) => {
        const key = `${target.channel}:${target.target}:${target.topic ?? ""}`
        if (seen.has(key)) {
            return false
        }

        seen.add(key)
        return true
    })
}

function normalizeRequiredField(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function createPromptKey(entry: PreparedMailboxEntry, recordedAtMs: number, index: number): string {
    if (entry.entry !== null) {
        return `mailbox:${entry.entry.id}:${recordedAtMs}`
    }

    return `synthetic:${recordedAtMs}:${index}`
}

function withAttachmentOrdinals(
    messageAttachments: BindingInboundMessage["attachments"],
): MailboxEntryRecord["attachments"] {
    return messageAttachments.map((attachment, ordinal) => ({
        ...attachment,
        ordinal,
    }))
}
