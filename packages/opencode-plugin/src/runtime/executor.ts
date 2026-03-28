import type {
    BindingCronJobSpec,
    BindingDeliveryReport,
    BindingDeliveryTarget,
    BindingDispatchReport,
    BindingExecutionReport,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingOpencodeCommand,
    BindingOpencodeCommandResult,
    BindingPreparedExecution,
    BindingPromptPart,
    GatewayBindingModule,
} from "../binding"
import type { GatewayExecutionConfig } from "../config/gateway"
import type { GatewayTextDelivery, TargetTextDeliverySession, TextDeliverySession } from "../delivery/text"
import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { OpencodeEventHub } from "../opencode/events"
import type { GatewaySessionAgentRuntime } from "../session/agent"
import type {
    MailboxEntryRecord,
    MailboxJobRecord,
    MailboxPreparedDelivery,
    RuntimeJournalEntry,
    SqliteStore,
} from "../store/sqlite"
import { type ActiveExecutionHandle, ActiveExecutionRegistry } from "./active-execution"
import { ConversationCoordinator } from "./conversation-coordinator"
import { delay } from "./delay"
import { ExecutionBudget, ExecutionHardTimeoutError } from "./execution-budget"
import { type PromptExecutionResult, runOpencodeDriver } from "./opencode-runner"
import { OpencodeCommandTimeoutError } from "./opencode-timeout"
import type { GatewayToolActivityHandle, GatewayToolActivityRuntime } from "./tool-activity"
import { GatewayToolOverlayPreviewSession } from "./tool-preview"

const SESSION_ABORT_POLL_MS = 250
const SESSION_RESIDUAL_BUSY_GRACE_POLLS = 3
const DEFAULT_EXECUTION_CONFIG: GatewayExecutionConfig = {
    sessionWaitTimeoutMs: 30 * 60_000,
    promptProgressTimeoutMs: 30 * 60_000,
    hardTimeoutMs: null,
    abortSettleTimeoutMs: 5_000,
}

export type MailboxExecutionOutcome = {
    conversationKey: string
    responseText: string
    finalText: string | null
    deliveries: MailboxPreparedDelivery[]
    sessionId: string
    recordedAtMs: number
}

export class GatewayExecutor {
    private internalPromptSequence = 0

    constructor(
        private readonly module: GatewayBindingModule,
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeRuntimeLike,
        private readonly events: OpencodeEventHub,
        private readonly delivery: GatewayTextDeliveryLike,
        private readonly logger: BindingLoggerHost,
        private readonly executionConfig: GatewayExecutionConfig = DEFAULT_EXECUTION_CONFIG,
        private readonly coordinator: ConversationCoordinator = new ConversationCoordinator(),
        private readonly toolActivity: GatewayToolActivityRuntime | null = null,
        private readonly activeExecutions: ActiveExecutionRegistry = new ActiveExecutionRegistry(),
        private readonly sessionAgents: Pick<GatewaySessionAgentRuntime, "resolveEffectivePrimaryAgent"> | null = null,
    ) {}

    prepareInboundMessage(message: BindingInboundMessage): BindingPreparedExecution {
        return this.module.prepareInboundExecution(message)
    }

    isConversationActive(conversationKey: string): boolean {
        return this.activeExecutions.isActiveConversation(conversationKey)
    }

    async requestConversationInterrupt(conversationKey: string): Promise<boolean> {
        return await this.activeExecutions.requestInterrupt(conversationKey, async (sessionId) => {
            await this.opencode.abortSession(sessionId)
        })
    }

    async handleInboundMessage(message: BindingInboundMessage): Promise<BindingDispatchReport> {
        const prepared = this.prepareInboundMessage(message)
        const syntheticEntry = {
            id: Date.now(),
            mailboxKey: prepared.conversationKey,
            ingressState: "ready",
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

    async executeMailboxEntries(entries: MailboxEntryRecord[]): Promise<BindingDispatchReport> {
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

    async executeMailboxJob(job: MailboxJobRecord): Promise<MailboxExecutionOutcome> {
        if (job.entries.length === 0) {
            throw new Error(`mailbox job ${job.id} contains no entries`)
        }

        const preparedEntries = job.entries.map((entry) => {
            const message = mailboxEntryToInboundMessage(entry)
            return {
                entry,
                message,
                prepared: this.prepareInboundMessage(message),
            }
        })
        const conversationKey = preparedEntries[0].prepared.conversationKey
        if (preparedEntries.some((entry) => entry.prepared.conversationKey !== conversationKey)) {
            throw new Error(`mailbox job ${job.id} contains mixed conversation keys`)
        }

        const recordedAtMs = Date.now()
        this.logger.log("info", `handling mailbox job ${job.id}`)

        return await this.coordinator.runExclusive(conversationKey, async () => {
            this.store.appendJournal(
                createJournalEntry("mailbox_flush", recordedAtMs, conversationKey, {
                    jobId: job.id,
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

            return await this.executePreparedBatchForMailbox(preparedEntries, recordedAtMs)
        })
    }

    async dispatchCronJob(job: BindingCronJobSpec): Promise<BindingDispatchReport> {
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

    async dispatchScheduledJob(input: DispatchScheduledJobInput): Promise<BindingDispatchReport> {
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
        const budget = new ExecutionBudget(this.executionConfig, input.recordedAtMs)
        const agent = await this.resolveConversationAgent(conversationKey)

        await this.coordinator.runExclusive(conversationKey, async () => {
            const sessionId = await this.ensureConversationSession(
                conversationKey,
                input.recordedAtMs,
                input.replyTarget === null ? [] : [input.replyTarget],
                budget,
            )
            const promptIdentity = this.createInternalPromptIdentity("context", input.recordedAtMs)
            try {
                await this.appendPrompt(
                    sessionId,
                    promptIdentity.messageId,
                    [
                        {
                            kind: "text",
                            partId: promptIdentity.partId,
                            text: body,
                        },
                    ],
                    agent,
                )
            } catch (error) {
                this.evictSessionBinding(conversationKey, sessionId, error)
                throw error
            }
        })
    }

    private async executePreparedBatch(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
    ): Promise<BindingDispatchReport> {
        const budget = new ExecutionBudget(this.executionConfig, recordedAtMs)
        const execution = await this.executePreparedBatchWithPreview(entries, recordedAtMs, budget)
        const delivery = await this.deliverImmediately(execution.targetSessions, execution.finalText)

        if (execution.finalText !== null && delivery !== null && delivery.deliveredTargets.length > 0) {
            this.store.appendJournal(
                createJournalEntry("delivery", recordedAtMs, execution.conversationKey, {
                    deliveryTargets: delivery.deliveredTargets,
                    body: execution.finalText,
                }),
            )
        }

        return {
            execution: toExecutionReport(execution, recordedAtMs),
            delivery,
        }
    }

    private async executePreparedBatchForMailbox(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
    ): Promise<MailboxExecutionOutcome> {
        const budget = new ExecutionBudget(this.executionConfig, recordedAtMs)
        const execution = await this.executePreparedBatchWithPreview(entries, recordedAtMs, budget)
        return {
            conversationKey: execution.conversationKey,
            responseText: execution.responseText,
            finalText: execution.finalText,
            deliveries: await handoffMailboxDeliveries(execution.targetSessions),
            sessionId: execution.sessionId,
            recordedAtMs,
        }
    }

    private async executePreparedBatchWithPreview(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
        budget: ExecutionBudget,
    ): Promise<PreparedExecutionWithPreview> {
        const conversationKey = entries[0].prepared.conversationKey
        const activeHandle = this.activeExecutions.begin(conversationKey)
        let completedExecution: ReturnType<ActiveExecutionRegistry["finish"]> | null = null
        const persistedSessionId = this.store.getSessionBinding(conversationKey)
        const replyTargets = dedupeReplyTargets(
            entries.flatMap((entry) => (entry.prepared.replyTarget === null ? [] : [entry.prepared.replyTarget])),
        )
        const targetSessions =
            replyTargets.length === 0 ? [] : await openTargetDeliverySessions(this.delivery, replyTargets)
        let previewSession = createPreviewFanoutSession(targetSessions)
        let toolActivity: GatewayToolActivityHandle | null = null
        if (previewSession !== null && previewSession.mode === "progressive" && this.toolActivity !== null) {
            const overlayPreview = new GatewayToolOverlayPreviewSession(previewSession)
            previewSession = overlayPreview
            toolActivity =
                this.toolActivity.beginExecution(replyTargets, async (toolSections) => {
                    await overlayPreview.setToolSections(toolSections)
                }) ?? null
        }

        try {
            const preparedSessionId = await this.preparePersistedSessionForPrompt(
                conversationKey,
                persistedSessionId,
                budget,
            )
            const expectedSessionBinding = this.store.getSessionBinding(conversationKey)
            const promptResult = await this.executeDriver(
                entries,
                recordedAtMs,
                preparedSessionId,
                targetSessions,
                previewSession,
                replyTargets,
                budget,
                toolActivity,
                activeHandle,
            )
            if (this.activeExecutions.wasInterrupted(activeHandle)) {
                throw new InterruptedExecutionError(conversationKey, promptResult.sessionId)
            }
            await this.cleanupResidualBusySession(promptResult.sessionId, budget)

            this.store.putSessionBindingIfUnchanged(
                conversationKey,
                expectedSessionBinding,
                promptResult.sessionId,
                recordedAtMs,
            )

            return {
                conversationKey,
                responseText: promptResult.responseText,
                finalText: promptResult.finalText,
                sessionId: promptResult.sessionId,
                targetSessions,
            }
        } catch (error) {
            completedExecution = completedExecution ?? this.activeExecutions.finish(activeHandle)
            await finishTargetSessions(targetSessions, null)
            if (completedExecution.interrupted) {
                await this.cleanupInterruptedExecution(conversationKey, completedExecution)
                throw error instanceof InterruptedExecutionError
                    ? error
                    : new InterruptedExecutionError(conversationKey, completedExecution.sessionId)
            }
            if (error instanceof ExecutionHardTimeoutError) {
                this.store.appendJournal(
                    createJournalEntry("execution_timeout", Date.now(), conversationKey, {
                        stage: "hard_timeout",
                        sessionId: persistedSessionId,
                        error: error.message,
                    }),
                )
            } else if (error instanceof OpencodeCommandTimeoutError) {
                this.store.appendJournal(
                    createJournalEntry("execution_timeout", Date.now(), conversationKey, {
                        stage: error.stage,
                        sessionId: error.sessionId,
                        error: error.message,
                    }),
                )
            }
            if (persistedSessionId !== null) {
                this.evictSessionBinding(conversationKey, persistedSessionId, error)
            }

            throw error
        } finally {
            completedExecution = completedExecution ?? this.activeExecutions.finish(activeHandle)
            await toolActivity?.finish(Date.now())
        }
    }

    private async ensureConversationSession(
        conversationKey: string,
        recordedAtMs: number,
        replyTargets: BindingDeliveryTarget[],
        budget: ExecutionBudget,
    ): Promise<string> {
        const persistedSessionId = this.store.getSessionBinding(conversationKey)
        let sessionId = await this.preparePersistedSessionForPrompt(conversationKey, persistedSessionId, budget)
        const expectedSessionBinding = this.store.getSessionBinding(conversationKey)
        let retryMissingSession = true

        for (;;) {
            if (sessionId === null) {
                budget.throwIfHardTimedOut("creating a conversation session")
                sessionId = await this.createSession(conversationKey)
            }

            try {
                await this.waitUntilIdle(sessionId, budget)
                break
            } catch (error) {
                if (retryMissingSession && error instanceof MissingSessionCommandError) {
                    retryMissingSession = false
                    if (persistedSessionId === sessionId) {
                        this.evictSessionBinding(conversationKey, sessionId, error)
                    }
                    sessionId = null
                    continue
                }

                if (persistedSessionId === sessionId) {
                    this.evictSessionBinding(conversationKey, sessionId, error)
                }

                throw error
            }
        }

        this.store.putSessionBindingIfUnchanged(conversationKey, expectedSessionBinding, sessionId, recordedAtMs)
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

    private async preparePersistedSessionForPrompt(
        conversationKey: string,
        sessionId: string | null,
        budget: ExecutionBudget,
    ): Promise<string | null> {
        if (sessionId === null) {
            return null
        }

        budget.throwIfHardTimedOut("looking up the persisted session")
        const found = await this.lookupSession(sessionId)
        if (!found) {
            this.evictSessionBinding(conversationKey, sessionId, "persisted session no longer exists")
            return null
        }

        if (!(await this.opencode.isSessionBusy(sessionId))) {
            return sessionId
        }

        this.logger.log("warn", `aborting busy gateway session before prompt dispatch: ${sessionId}`)

        try {
            await this.abortSessionAndWaitForSettle(sessionId, budget)
            return sessionId
        } catch (error) {
            this.logger.log(
                "warn",
                `busy gateway session did not settle and will be replaced: ${sessionId}: ${extractErrorMessage(error)}`,
            )
            this.evictSessionBinding(conversationKey, sessionId, error)
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

    private async waitUntilIdle(sessionId: string, budget: ExecutionBudget): Promise<void> {
        const result = await this.opencode.execute({
            kind: "waitUntilIdle",
            sessionId,
            timeoutMs: budget.sessionWaitTimeoutMs(),
        })
        expectCommandResult(result, "waitUntilIdle", "session_wait")
    }

    private async appendPrompt(
        sessionId: string,
        messageId: string,
        parts: BindingOpencodeCommandPartLike[],
        agent: string | null = null,
    ): Promise<void> {
        const result = await this.opencode.execute({
            kind: "appendPrompt",
            sessionId,
            messageId,
            agent: agent ?? undefined,
            parts,
        })
        expectCommandResult(result, "appendPrompt")
    }

    private evictSessionBinding(conversationKey: string, sessionId: string, error: unknown): void {
        if (this.store.getSessionBinding(conversationKey) !== sessionId) {
            return
        }

        this.logger.log(
            "warn",
            `evicting persisted gateway session binding ${conversationKey} -> ${sessionId}: ${extractErrorMessage(error)}`,
        )
        this.store.deleteSessionBinding(conversationKey)
    }

    private async cleanupResidualBusySession(sessionId: string, budget: ExecutionBudget): Promise<void> {
        if (await this.waitForSessionToSettle(sessionId, SESSION_RESIDUAL_BUSY_GRACE_POLLS)) {
            return
        }

        this.logger.log("debug", `aborting residual busy gateway session after prompt completion: ${sessionId}`)

        try {
            await this.abortSessionAndWaitForSettle(sessionId, budget)
        } catch (error) {
            this.logger.log(
                "warn",
                `residual busy gateway session did not settle after abort: ${sessionId}: ${extractErrorMessage(error)}`,
            )
        }
    }

    private async waitForSessionToSettle(sessionId: string, extraPolls: number): Promise<boolean> {
        for (let attempt = 0; attempt <= extraPolls; attempt += 1) {
            if (!(await this.opencode.isSessionBusy(sessionId))) {
                return true
            }

            if (attempt < extraPolls) {
                await delay(SESSION_ABORT_POLL_MS)
            }
        }

        return false
    }

    private async abortSessionAndWaitForSettle(sessionId: string, budget: ExecutionBudget): Promise<void> {
        await this.opencode.abortSession(sessionId)

        const deadline = Date.now() + budget.abortSettleTimeoutMs()
        for (;;) {
            if (!(await this.opencode.isSessionBusy(sessionId))) {
                return
            }

            if (Date.now() >= deadline) {
                throw new Error(`session remained busy after abort for ${budget.abortSettleTimeoutMs()}ms`)
            }

            await delay(SESSION_ABORT_POLL_MS)
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

    private async deliverImmediately(
        targetSessions: TargetTextDeliverySession[],
        finalText: string | null,
    ): Promise<BindingDeliveryReport | null> {
        if (targetSessions.length === 0) {
            await finishTargetSessions(targetSessions, finalText)
            return null
        }

        const attempts = await finishTargetSessions(targetSessions, finalText)
        return {
            attemptedTargets: attempts.map((attempt) => attempt.deliveryTarget),
            deliveredTargets: attempts.filter((attempt) => attempt.delivered).map((attempt) => attempt.deliveryTarget),
            failedTargets: attempts
                .filter((attempt) => !attempt.delivered)
                .map((attempt) => ({
                    deliveryTarget: attempt.deliveryTarget,
                    errorMessage: attempt.errorMessage ?? "delivery failed",
                })),
        }
    }

    private async executeDriver(
        entries: PreparedMailboxEntry[],
        recordedAtMs: number,
        persistedSessionId: string | null,
        targetSessions: TargetTextDeliverySession[],
        deliverySession: TextDeliverySessionLike | null,
        replyTargets: NonNullable<BindingPreparedExecution["replyTarget"]>[],
        budget: ExecutionBudget,
        toolActivity: Pick<GatewayToolActivityHandle, "trackSession" | "finish"> | null,
        activeHandle: ActiveExecutionHandle,
    ): Promise<PromptExecutionResult> {
        const conversationKey = entries[0].prepared.conversationKey
        const agent = await this.resolveConversationAgent(conversationKey)

        return await runOpencodeDriver({
            module: this.module,
            opencode: this.opencode,
            events: this.events,
            conversationKey,
            persistedSessionId,
            deliverySession,
            prompts: entries.map((entry, index) => ({
                promptKey: createPromptKey(entry, recordedAtMs, index),
                parts: entry.prepared.promptParts,
            })),
            prepareCommand: async (command) => injectAgentIntoPromptCommand(command, agent),
            onSessionAvailable: async (sessionId) => {
                this.activeExecutions.updateSession(activeHandle, sessionId)
                this.store.replaceSessionReplyTargets({
                    sessionId,
                    conversationKey,
                    targets: replyTargets,
                    recordedAtMs,
                })
                bindTargetSessions(targetSessions, sessionId)
                toolActivity?.trackSession(sessionId)
            },
            onCommand: async (command) => {
                if (command.kind === "sendPromptAsync") {
                    this.activeExecutions.setPromptMessageId(activeHandle, command.messageId)
                }
            },
            shouldInterrupt: () => this.activeExecutions.wasInterrupted(activeHandle),
            budget,
        })
    }

    private async resolveConversationAgent(conversationKey: string): Promise<string | null> {
        if (this.sessionAgents === null) {
            return null
        }

        try {
            return await this.sessionAgents.resolveEffectivePrimaryAgent(conversationKey)
        } catch (error) {
            this.logger.log(
                "warn",
                `failed to resolve route-scoped agent for ${conversationKey}: ${extractErrorMessage(error)}`,
            )
            return null
        }
    }

    private async cleanupInterruptedExecution(
        conversationKey: string,
        execution: ReturnType<ActiveExecutionRegistry["finish"]>,
    ): Promise<void> {
        if (execution.sessionId === null) {
            return
        }

        if (execution.assistantMessageId === null) {
            this.evictSessionBinding(
                conversationKey,
                execution.sessionId,
                "interrupt completed without an assistant message to revert",
            )
            return
        }

        try {
            await this.opencode.revertSessionMessage(execution.sessionId, execution.assistantMessageId)
        } catch (error) {
            this.evictSessionBinding(conversationKey, execution.sessionId, error)
        }
    }
}

export type GatewayExecutorLike = Pick<
    GatewayExecutor,
    | "handleInboundMessage"
    | "dispatchCronJob"
    | "dispatchScheduledJob"
    | "appendContextToConversation"
    | "executeMailboxJob"
    | "executeMailboxEntries"
    | "isConversationActive"
    | "prepareInboundMessage"
    | "requestConversationInterrupt"
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

type PreparedExecutionWithPreview = {
    conversationKey: string
    responseText: string
    finalText: string | null
    sessionId: string
    targetSessions: TargetTextDeliverySession[]
}

type ImmediateDeliveryAttempt = {
    deliveryTarget: BindingDeliveryTarget
    delivered: boolean
    errorMessage: string | null
}

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "openMany" | "openTargetSessions">
type GatewayOpencodeRuntimeLike = Pick<
    OpencodeSdkAdapter,
    "execute" | "isSessionBusy" | "abortSession" | "revertSessionMessage"
>
type TextDeliverySessionLike = Pick<TextDeliverySession, "mode" | "preview">
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

function toExecutionReport(
    execution: Pick<PreparedExecutionWithPreview, "conversationKey" | "responseText" | "finalText">,
    recordedAtMs: number,
): BindingExecutionReport {
    return {
        conversationKey: execution.conversationKey,
        responseText: execution.responseText,
        finalText: execution.finalText,
        recordedAtMs: BigInt(recordedAtMs),
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

function injectAgentIntoPromptCommand(command: BindingOpencodeCommand, agent: string | null): BindingOpencodeCommand {
    if (agent === null) {
        return command
    }

    switch (command.kind) {
        case "appendPrompt":
        case "sendPromptAsync":
            return {
                ...command,
                agent,
            }
        default:
            return command
    }
}

function createPreviewFanoutSession(
    targetSessions: TargetTextDeliverySession[],
): Pick<TextDeliverySession, "mode" | "preview"> | null {
    if (targetSessions.length === 0) {
        return null
    }

    return {
        mode: targetSessions.some((entry) => entry.session.mode === "progressive") ? "progressive" : "oneshot",
        async preview(preview): Promise<void> {
            await Promise.all(targetSessions.map((entry) => entry.session.preview(preview)))
        },
    }
}

async function openTargetDeliverySessions(
    delivery: GatewayTextDeliveryLike,
    replyTargets: NonNullable<BindingPreparedExecution["replyTarget"]>[],
): Promise<TargetTextDeliverySession[]> {
    if (typeof delivery.openTargetSessions === "function") {
        return await delivery.openTargetSessions(replyTargets, "auto")
    }

    const sessions = await delivery.openMany(replyTargets, "auto")
    if (sessions.length !== 1 || replyTargets.length !== 1) {
        throw new Error("per-target delivery sessions are unavailable")
    }

    return [
        {
            target: replyTargets[0],
            session: sessions[0],
        },
    ]
}

async function finishTargetSessions(
    targetSessions: TargetTextDeliverySession[],
    finalText: string | null,
): Promise<ImmediateDeliveryAttempt[]> {
    if (targetSessions.length === 0) {
        return []
    }

    return await Promise.all(
        targetSessions.map(async ({ target, session }) => {
            try {
                return {
                    deliveryTarget: target,
                    delivered: await session.finish(finalText),
                    errorMessage: null,
                } satisfies ImmediateDeliveryAttempt
            } catch (error) {
                return {
                    deliveryTarget: target,
                    delivered: false,
                    errorMessage: extractErrorMessage(error),
                } satisfies ImmediateDeliveryAttempt
            }
        }),
    )
}

function bindTargetSessions(targetSessions: TargetTextDeliverySession[], sessionId: string): void {
    for (const { session } of targetSessions) {
        if (typeof session.bindSession === "function") {
            session.bindSession(sessionId)
        }
    }
}

async function handoffMailboxDeliveries(
    targetSessions: TargetTextDeliverySession[],
): Promise<MailboxPreparedDelivery[]> {
    return await Promise.all(
        targetSessions.map(async ({ target, session }) => {
            const handle = await session.handoffFinalDelivery()
            return {
                deliveryTarget: target,
                strategy: handle.strategy,
                previewContext: handle.previewContext,
            } satisfies MailboxPreparedDelivery
        }),
    )
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
    timeoutStage: "session_wait" | "prompt_progress" | "command" = "command",
): Extract<BindingOpencodeCommandResult, { kind: TKind }> {
    if (result.kind === "error") {
        if (result.code === "missingSession") {
            throw new MissingSessionCommandError(result.message)
        }

        if (result.code === "timeout") {
            throw new OpencodeCommandTimeoutError(timeoutStage, result.message, result.sessionId)
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

export class InterruptedExecutionError extends Error {
    constructor(
        readonly conversationKey: string,
        readonly sessionId: string | null,
    ) {
        super(`execution interrupted for conversation ${conversationKey}`)
        this.name = "InterruptedExecutionError"
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
