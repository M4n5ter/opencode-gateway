import type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingOpencodeCommand,
    BindingOpencodeCommandResult,
    BindingPreparedExecution,
    BindingPromptPart,
    BindingRuntimeReport,
    GatewayBindingModule,
} from "../binding"
import type { GatewayTextDelivery, TextDeliverySession } from "../delivery/text"
import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { OpencodeEventHub } from "../opencode/events"
import type { MailboxEntryRecord, RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { ConversationCoordinator } from "./conversation-coordinator"
import { type PromptExecutionResult, runOpencodeDriver } from "./opencode-runner"

const SESSION_ABORT_SETTLE_TIMEOUT_MS = 5_000
const SESSION_ABORT_POLL_MS = 250

export class GatewayExecutor {
    private internalPromptSequence = 0

    constructor(
        private readonly module: GatewayBindingModule,
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeRuntimeLike,
        private readonly events: OpencodeEventHub,
        private readonly delivery: GatewayTextDeliveryLike,
        private readonly logger: BindingLoggerHost,
        private readonly coordinator: ConversationCoordinator = new ConversationCoordinator(),
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
        return await this.coordinator.runExclusive(conversationKey, async () => {
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

            return await this.executePreparedBatch(preparedEntries, recordedAtMs)
        })
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

        return await this.coordinator.runExclusive(prepared.conversationKey, async () => {
            return await this.executePreparedBatch(
                [
                    {
                        entry: null,
                        message: null,
                        prepared,
                    },
                ],
                recordedAtMs,
            )
        })
    }

    async dispatchScheduledJob(input: DispatchScheduledJobInput): Promise<BindingRuntimeReport> {
        const prepared = prepareTextExecution(input.conversationKey, input.prompt, input.replyTarget)
        const recordedAtMs = Date.now()

        this.logger.log("info", "dispatching scheduled gateway job")
        return await this.coordinator.runExclusive(prepared.conversationKey, async () => {
            this.store.appendJournal(
                createJournalEntry("cron_dispatch", recordedAtMs, prepared.conversationKey, {
                    id: input.jobId,
                    kind: input.jobKind,
                    promptParts: prepared.promptParts,
                    deliveryChannel: prepared.replyTarget?.channel ?? null,
                    deliveryTarget: prepared.replyTarget?.target ?? null,
                    deliveryTopic: prepared.replyTarget?.topic ?? null,
                }),
            )

            return await this.executePreparedBatch(
                [
                    {
                        entry: null,
                        message: null,
                        prepared,
                    },
                ],
                recordedAtMs,
            )
        })
    }

    async appendContextToConversation(input: AppendContextToConversationInput): Promise<void> {
        const conversationKey = normalizeRequiredField(input.conversationKey, "conversation key")
        const body = normalizeRequiredField(input.body, "context body")

        await this.coordinator.runExclusive(conversationKey, async () => {
            const sessionId = await this.ensureConversationSession(
                conversationKey,
                input.recordedAtMs,
                input.replyTarget === null ? [] : [input.replyTarget],
            )
            const promptIdentity = this.createInternalPromptIdentity("context", input.recordedAtMs)

            await this.appendPrompt(sessionId, promptIdentity.messageId, [
                {
                    kind: "text",
                    partId: promptIdentity.partId,
                    text: body,
                },
            ])
        })
    }

    private async executePreparedBatch(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
    ): Promise<BindingRuntimeReport> {
        const conversationKey = entries[0].prepared.conversationKey
        const persistedSessionId = this.store.getSessionBinding(conversationKey)
        const preparedSessionId = await this.preparePersistedSessionForPrompt(persistedSessionId)
        const replyTargets = dedupeReplyTargets(
            entries.flatMap((entry) => (entry.prepared.replyTarget === null ? [] : [entry.prepared.replyTarget])),
        )
        const [deliverySession] =
            replyTargets.length === 0 ? [null] : await this.delivery.openMany(replyTargets, "auto")
        const promptResult = await this.executeDriver(
            entries,
            recordedAtMs,
            preparedSessionId,
            deliverySession,
            replyTargets,
        )
        await this.cleanupResidualBusySession(promptResult.sessionId)

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

    private async ensureConversationSession(
        conversationKey: string,
        recordedAtMs: number,
        replyTargets: BindingDeliveryTarget[],
    ): Promise<string> {
        const persistedSessionId = this.store.getSessionBinding(conversationKey)
        let sessionId = await this.preparePersistedSessionForPrompt(persistedSessionId)
        let retryMissingSession = true

        for (;;) {
            if (sessionId === null) {
                sessionId = await this.createSession(conversationKey)
            }

            try {
                await this.waitUntilIdle(sessionId)
                break
            } catch (error) {
                if (retryMissingSession && error instanceof MissingSessionCommandError) {
                    retryMissingSession = false
                    sessionId = null
                    continue
                }

                throw error
            }
        }

        this.store.putSessionBindingIfUnchanged(conversationKey, persistedSessionId, sessionId, recordedAtMs)
        this.initializeReplyTargetsIfMissing(sessionId, conversationKey, replyTargets, recordedAtMs)

        return sessionId
    }

    private initializeReplyTargetsIfMissing(
        sessionId: string,
        conversationKey: string,
        replyTargets: BindingDeliveryTarget[],
        recordedAtMs: number,
    ): void {
        if (replyTargets.length === 0 || this.store.listSessionReplyTargets(sessionId).length > 0) {
            return
        }

        this.store.replaceSessionReplyTargets({
            sessionId,
            conversationKey,
            targets: replyTargets,
            recordedAtMs,
        })
    }

    private async preparePersistedSessionForPrompt(sessionId: string | null): Promise<string | null> {
        if (sessionId === null) {
            return null
        }

        const found = await this.lookupSession(sessionId)
        if (!found) {
            return null
        }

        if (!(await this.opencode.isSessionBusy(sessionId))) {
            return sessionId
        }

        this.logger.log("warn", `aborting busy gateway session before prompt dispatch: ${sessionId}`)

        try {
            await this.abortSessionAndWaitForSettle(sessionId)
            return sessionId
        } catch (error) {
            this.logger.log(
                "warn",
                `busy gateway session did not settle and will be replaced: ${sessionId}: ${extractErrorMessage(error)}`,
            )
            return null
        }
    }

    private async lookupSession(sessionId: string): Promise<boolean> {
        const result = await this.opencode.execute({
            kind: "lookupSession",
            sessionId,
        })
        const lookup = expectCommandResult(result, "lookupSession")
        return lookup.found
    }

    private async createSession(conversationKey: string): Promise<string> {
        const result = await this.opencode.execute({
            kind: "createSession",
            title: `Gateway ${conversationKey}`,
        })
        return expectCommandResult(result, "createSession").sessionId
    }

    private async waitUntilIdle(sessionId: string): Promise<void> {
        const result = await this.opencode.execute({
            kind: "waitUntilIdle",
            sessionId,
        })
        expectCommandResult(result, "waitUntilIdle")
    }

    private async appendPrompt(
        sessionId: string,
        messageId: string,
        parts: BindingOpencodeCommandPartLike[],
    ): Promise<void> {
        const result = await this.opencode.execute({
            kind: "appendPrompt",
            sessionId,
            messageId,
            parts,
        })
        expectCommandResult(result, "appendPrompt")
    }

    private async cleanupResidualBusySession(sessionId: string): Promise<void> {
        if (!(await this.opencode.isSessionBusy(sessionId))) {
            return
        }

        this.logger.log("warn", `aborting residual busy gateway session after prompt completion: ${sessionId}`)

        try {
            await this.abortSessionAndWaitForSettle(sessionId)
        } catch (error) {
            this.logger.log(
                "warn",
                `residual busy gateway session did not settle after abort: ${sessionId}: ${extractErrorMessage(error)}`,
            )
        }
    }

    private async abortSessionAndWaitForSettle(sessionId: string): Promise<void> {
        await this.opencode.abortSession(sessionId)

        const deadline = Date.now() + SESSION_ABORT_SETTLE_TIMEOUT_MS
        for (;;) {
            if (!(await this.opencode.isSessionBusy(sessionId))) {
                return
            }

            if (Date.now() >= deadline) {
                throw new Error(`session remained busy after abort for ${SESSION_ABORT_SETTLE_TIMEOUT_MS}ms`)
            }

            await Bun.sleep(SESSION_ABORT_POLL_MS)
        }
    }

    private createInternalPromptIdentity(
        prefix: string,
        recordedAtMs: number,
    ): {
        messageId: string
        partId: string
    } {
        const suffix = `${recordedAtMs}_${this.internalPromptSequence}`
        this.internalPromptSequence += 1
        const normalizedPrefix = prefix.replaceAll(":", "_")

        return {
            messageId: `msg_gateway_${normalizedPrefix}_${suffix}`,
            partId: `prt_gateway_${normalizedPrefix}_${suffix}_0`,
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
    | "handleInboundMessage"
    | "dispatchCronJob"
    | "dispatchScheduledJob"
    | "appendContextToConversation"
    | "executeMailboxEntries"
    | "prepareInboundMessage"
>

export type DispatchScheduledJobInput = {
    jobId: string
    jobKind: "cron" | "once"
    conversationKey: string
    prompt: string
    replyTarget: BindingPreparedExecution["replyTarget"]
}

export type AppendContextToConversationInput = {
    conversationKey: string
    replyTarget: BindingDeliveryTarget | null
    body: string
    recordedAtMs: number
}

type PreparedMailboxEntry = {
    entry: MailboxEntryRecord | null
    message: BindingInboundMessage | null
    prepared: BindingPreparedExecution
}

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "openMany">
type GatewayOpencodeRuntimeLike = Pick<OpencodeSdkAdapter, "execute" | "isSessionBusy" | "abortSession">
type TextDeliverySessionLike = Pick<TextDeliverySession, "mode" | "preview" | "finish">
type BindingOpencodeCommandPartLike = Extract<BindingOpencodeCommand, { kind: "appendPrompt" }>["parts"][number]

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

function prepareTextExecution(
    conversationKey: string,
    prompt: string,
    replyTarget: BindingPreparedExecution["replyTarget"],
): BindingPreparedExecution {
    return {
        conversationKey: normalizeRequiredField(conversationKey, "conversation key"),
        promptParts: [
            {
                kind: "text",
                text: normalizeRequiredField(prompt, "schedule prompt"),
            } satisfies BindingPromptPart,
        ],
        replyTarget,
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

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return String(error)
}

function expectCommandResult<TKind extends BindingOpencodeCommandResult["kind"]>(
    result: BindingOpencodeCommandResult,
    expectedKind: TKind,
): Extract<BindingOpencodeCommandResult, { kind: TKind }> {
    if (result.kind === "error") {
        if (result.code === "missingSession") {
            throw new MissingSessionCommandError(result.message)
        }

        throw new Error(result.message)
    }

    if (result.kind !== expectedKind) {
        throw new Error(`unexpected OpenCode result kind: expected ${expectedKind}, received ${result.kind}`)
    }

    return result as Extract<BindingOpencodeCommandResult, { kind: TKind }>
}

class MissingSessionCommandError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "MissingSessionCommandError"
    }
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
