import type { BindingInboundMessage, BindingLoggerHost } from "../binding"
import type { GatewayInflightMessagesConfig, GatewayMailboxConfig } from "../config/gateway"
import type { GatewayTransportHost } from "../host/transport"
import type { GatewayInteractionRuntime } from "../interactions/runtime"
import type { MailboxDeliveryRecord, MailboxJobRecord, RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import { deleteInboundAttachmentFiles } from "./attachments"
import { type GatewayExecutor, InterruptedExecutionError } from "./executor"
import type { GatewayInflightPolicyRuntime } from "./inflight-policy"

const EXECUTION_LEASE_MS = 60_000
const EXECUTION_LEASE_HEARTBEAT_MS = 15_000
const DELIVERY_LEASE_MS = 60_000
const EXECUTION_RETRY_DELAY_MS = 5_000
const DELIVERY_RETRY_DELAY_MS = 10_000
const EXECUTION_MAX_ATTEMPTS = 3
const DELIVERY_MAX_ATTEMPTS = 5
const SWEEP_INTERVAL_MS = 1_000
const MAX_ACTIVE_EXECUTIONS = 4
const MAX_ACTIVE_DELIVERIES = 8

const DEFAULT_INFLIGHT_CONFIG: GatewayInflightMessagesConfig = {
    defaultPolicy: "ask",
}

const DEFAULT_INFLIGHT_POLICY_RUNTIME: GatewayInflightPolicyRuntimeLike = {
    async interruptCurrent(): Promise<void> {},
    async recoverOnStartup(): Promise<void> {},
}

export class GatewayMailboxRuntime {
    private drainScheduled = false
    private drainActive = false
    private drainRequested = false
    private sweepTimer: ReturnType<typeof setInterval> | null = null
    private activeExecutions = 0
    private activeDeliveries = 0
    private stopped = false

    constructor(
        private readonly executor: GatewayExecutorLike,
        private readonly transport: GatewayTransportLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: GatewayMailboxConfig,
        private readonly interactions: GatewayInteractionRuntimeLike,
        private readonly inflightConfig: GatewayInflightMessagesConfig = DEFAULT_INFLIGHT_CONFIG,
        private readonly inflightPolicy: GatewayInflightPolicyRuntimeLike = DEFAULT_INFLIGHT_POLICY_RUNTIME,
    ) {}

    start(): void {
        this.stopped = false
        this.store.requeueExpiredMailboxLeases(Date.now())
        this.inflightPolicy.recoverOnStartup()
        this.ensureSweep()
        this.scheduleDrain(0)
    }

    stop(): void {
        this.stopped = true
        if (this.sweepTimer !== null) {
            clearInterval(this.sweepTimer)
            this.sweepTimer = null
        }
    }

    scheduleDrainNow(): void {
        this.scheduleDrain(0)
    }

    async enqueueInboundMessage(message: BindingInboundMessage, sourceKind: string, externalId: string): Promise<void> {
        if (await this.interactions.tryHandleInboundMessage(message)) {
            return
        }

        const prepared = this.executor.prepareInboundMessage(message)
        const recordedAtMs = Date.now()
        const activeConversation =
            typeof this.executor.isConversationActive === "function"
                ? this.executor.isConversationActive(prepared.conversationKey)
                : false
        const ingressState =
            activeConversation && this.inflightConfig.defaultPolicy === "ask" ? "held_for_inflight_policy" : "ready"

        this.store.enqueueMailboxEntry({
            mailboxKey: prepared.conversationKey,
            ingressState,
            sourceKind,
            externalId,
            sender: message.sender,
            text: message.text,
            attachments: message.attachments,
            replyChannel: message.deliveryTarget.channel,
            replyTarget: message.deliveryTarget.target,
            replyTopic: message.deliveryTarget.topic,
            recordedAtMs,
        })
        this.store.appendJournal(
            createJournalEntry("mailbox_enqueue", recordedAtMs, prepared.conversationKey, {
                sourceKind,
                externalId,
                sender: message.sender,
                text: message.text,
                attachments: message.attachments,
                deliveryTarget: message.deliveryTarget,
            }),
        )

        if (activeConversation) {
            await this.handleActiveConversationIngress(prepared.conversationKey, ingressState)
        }

        this.scheduleDrain(0)
    }

    private ensureSweep(): void {
        if (this.sweepTimer !== null) {
            return
        }

        this.sweepTimer = setInterval(() => {
            this.scheduleDrain(0)
        }, SWEEP_INTERVAL_MS)
    }

    private scheduleDrain(delayMs: number): void {
        if (this.stopped) {
            return
        }

        if (this.drainActive || this.drainScheduled) {
            this.drainRequested = true
            return
        }

        this.drainScheduled = true
        setTimeout(() => {
            this.drainScheduled = false
            if (this.stopped) {
                return
            }
            void this.drain()
        }, delayMs)
    }

    private async drain(): Promise<void> {
        if (this.stopped) {
            return
        }

        if (this.drainActive) {
            this.drainRequested = true
            return
        }

        this.drainActive = true

        try {
            for (;;) {
                this.drainRequested = false
                const nowMs = Date.now()
                this.store.requeueExpiredMailboxLeases(nowMs)
                this.store.materializeMailboxJobs(nowMs, this.config.batchReplies, this.config.batchWindowMs)

                let startedWork = false
                startedWork = this.startExecutionWorkers(nowMs) || startedWork
                startedWork = this.startDeliveryWorkers(nowMs) || startedWork

                if (!this.drainRequested && !startedWork) {
                    return
                }
            }
        } finally {
            this.drainActive = false
            if (this.drainRequested) {
                this.scheduleDrain(0)
            }
        }
    }

    private startExecutionWorkers(nowMs: number): boolean {
        if (this.stopped) {
            return false
        }

        let started = false

        while (this.activeExecutions < MAX_ACTIVE_EXECUTIONS) {
            const job = this.store.claimNextMailboxJob(nowMs, nowMs + EXECUTION_LEASE_MS)
            if (job === null) {
                break
            }

            started = true
            this.activeExecutions += 1
            void this.processJob(job).finally(() => {
                this.activeExecutions -= 1
                this.scheduleDrain(0)
            })
        }

        return started
    }

    private startDeliveryWorkers(nowMs: number): boolean {
        if (this.stopped) {
            return false
        }

        let started = false

        while (this.activeDeliveries < MAX_ACTIVE_DELIVERIES) {
            const delivery = this.store.claimNextMailboxDelivery(nowMs, nowMs + DELIVERY_LEASE_MS)
            if (delivery === null) {
                break
            }

            started = true
            this.activeDeliveries += 1
            void this.processDelivery(delivery).finally(() => {
                this.activeDeliveries -= 1
                this.scheduleDrain(0)
            })
        }

        return started
    }

    private async processJob(job: MailboxJobRecord): Promise<void> {
        const stopHeartbeat = this.startExecutionLeaseHeartbeat(job.id)

        try {
            const outcome = await this.executor.executeMailboxJob(job)
            const finalized = this.store.completeMailboxJobExecution({
                jobId: job.id,
                sessionId: outcome.sessionId,
                responseText: outcome.responseText,
                finalText: outcome.finalText,
                deliveries: outcome.deliveries,
                recordedAtMs: outcome.recordedAtMs,
                deliveryRetryAtMs: outcome.recordedAtMs,
            })
            if (finalized.status === "ready_to_deliver") {
                this.store.appendJournal(
                    createJournalEntry("mailbox_delivery_queued", outcome.recordedAtMs, job.mailboxKey, {
                        jobId: job.id,
                    }),
                )
            }
            await this.maybeResolveCompletedInflightDecision(job.mailboxKey)
            await deleteInboundAttachmentFiles(finalized.cleanupEntries, this.logger)
        } catch (error) {
            if (error instanceof InterruptedExecutionError) {
                const recordedAtMs = Date.now()
                const finalized = this.store.interruptMailboxJob(job.id, recordedAtMs)
                await this.maybeResolveCompletedInflightDecision(job.mailboxKey)
                await deleteInboundAttachmentFiles(finalized.cleanupEntries, this.logger)
                this.logger.log("info", `interrupted mailbox job ${job.id}`)
                return
            }

            const recordedAtMs = Date.now()
            const quarantined = this.store.recordMailboxJobFailure(
                job.id,
                formatError(error),
                recordedAtMs,
                recordedAtMs + EXECUTION_RETRY_DELAY_MS,
                EXECUTION_MAX_ATTEMPTS,
            )
            if (quarantined) {
                this.store.appendJournal(
                    createJournalEntry("mailbox_job_quarantined", recordedAtMs, job.mailboxKey, {
                        jobId: job.id,
                        error: formatError(error),
                    }),
                )
            }
            this.logger.log(
                quarantined ? "error" : "warn",
                `${quarantined ? "quarantined" : "retrying"} mailbox job ${job.id}: ${formatError(error)}`,
            )
            await this.maybeResolveCompletedInflightDecision(job.mailboxKey)
        } finally {
            stopHeartbeat()
        }
    }

    private async processDelivery(delivery: MailboxDeliveryRecord): Promise<void> {
        const job = this.store.getMailboxJob(delivery.jobId)
        if (job === null) {
            this.logger.log("warn", `mailbox delivery ${delivery.id} references missing job ${delivery.jobId}`)
            return
        }

        const finalText = job.finalText?.trim() ?? ""
        if (finalText.length === 0) {
            const finalized = this.store.recordMailboxDeliveryFailure(
                delivery.id,
                `mailbox job ${job.id} has no final text to deliver`,
                Date.now(),
                Date.now(),
                1,
            )
            await deleteInboundAttachmentFiles(finalized.cleanupEntries, this.logger)
            return
        }

        try {
            const ack = await this.transport.deliverMessage(
                {
                    deliveryTarget: delivery.deliveryTarget,
                    body: finalText,
                    previewContext: delivery.previewContext,
                },
                delivery.strategy,
            )
            if (ack.kind === "permanent_edit_failure") {
                this.store.downgradeMailboxDeliveryToSend(delivery.id, ack.errorMessage, Date.now())
                if (delivery.strategy.mode === "edit") {
                    this.store.deleteTelegramPreviewMessage(delivery.deliveryTarget.target, delivery.strategy.messageId)
                }
                this.logger.log(
                    "warn",
                    `mailbox delivery ${delivery.id} fell back from edit to send: ${ack.errorMessage}`,
                )
                return
            }

            if (ack.kind === "retryable_failure") {
                throw new Error(ack.errorMessage)
            }

            const finalized = this.store.markMailboxDeliveryDelivered(delivery.id, Date.now())
            this.store.appendJournal(
                createJournalEntry("delivery", Date.now(), job.mailboxKey, {
                    jobId: job.id,
                    deliveryTarget: delivery.deliveryTarget,
                    body: finalText,
                }),
            )
            await deleteInboundAttachmentFiles(finalized.cleanupEntries, this.logger)
        } catch (error) {
            const recordedAtMs = Date.now()
            const finalized = this.store.recordMailboxDeliveryFailure(
                delivery.id,
                formatError(error),
                recordedAtMs,
                recordedAtMs + DELIVERY_RETRY_DELAY_MS,
                DELIVERY_MAX_ATTEMPTS,
            )
            if (finalized.status === "quarantined") {
                this.store.appendJournal(
                    createJournalEntry("mailbox_delivery_quarantined", recordedAtMs, job.mailboxKey, {
                        deliveryId: delivery.id,
                        error: formatError(error),
                    }),
                )
            }
            await deleteInboundAttachmentFiles(finalized.cleanupEntries, this.logger)
            if (finalized.status === "quarantined") {
                this.logger.log("error", `quarantined mailbox delivery ${delivery.id}: ${formatError(error)}`)
            } else {
                this.logger.log("warn", `retrying mailbox delivery ${delivery.id}: ${formatError(error)}`)
            }
        }
    }

    private startExecutionLeaseHeartbeat(jobId: number): () => void {
        const timer = setInterval(() => {
            const nowMs = Date.now()
            this.store.renewMailboxJobLease(jobId, nowMs + EXECUTION_LEASE_MS, nowMs)
        }, EXECUTION_LEASE_HEARTBEAT_MS)

        return () => {
            clearInterval(timer)
        }
    }

    private async handleActiveConversationIngress(
        mailboxKey: string,
        ingressState: "ready" | "held_for_inflight_policy",
    ): Promise<void> {
        switch (this.inflightConfig.defaultPolicy) {
            case "queue":
                return
            case "interrupt":
                await this.inflightPolicy.interruptCurrent(mailboxKey)
                return
            case "ask":
                if (ingressState !== "held_for_inflight_policy") {
                    return
                }

                await this.interactions.ensureInflightPolicyRequest(
                    mailboxKey,
                    this.store.listHeldMailboxReplyTargets(mailboxKey),
                )
                return
        }
    }

    private async maybeResolveCompletedInflightDecision(mailboxKey: string): Promise<void> {
        const pending = this.store.listPendingInteractionsForMailbox(mailboxKey)
        if (pending.length === 0) {
            return
        }

        this.store.releaseHeldMailboxEntries(mailboxKey, Date.now())
        for (const interaction of pending) {
            this.interactions.resolveStaleInflightPolicyRequest(interaction)
        }
    }
}

type GatewayExecutorLike = Pick<GatewayExecutor, "executeMailboxJob" | "prepareInboundMessage" | "isConversationActive">
type GatewayTransportLike = Pick<GatewayTransportHost, "sendMessage" | "deliverMessage">
type GatewayInteractionRuntimeLike = Pick<
    GatewayInteractionRuntime,
    "tryHandleInboundMessage" | "ensureInflightPolicyRequest" | "resolveStaleInflightPolicyRequest"
>
type GatewayInflightPolicyRuntimeLike = Pick<GatewayInflightPolicyRuntime, "interruptCurrent" | "recoverOnStartup">

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
