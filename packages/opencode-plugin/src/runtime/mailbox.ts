import type { BindingInboundMessage, BindingLoggerHost } from "../binding"
import type { GatewayMailboxConfig } from "../config/gateway"
import type { GatewayInteractionRuntime } from "../interactions/runtime"
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import { deleteInboundAttachmentFiles } from "./attachments"
import type { GatewayExecutor } from "./executor"

const RETRY_DELAY_MS = 1_000

export class GatewayMailboxRuntime {
    private readonly activeMailboxes = new Set<string>()
    private readonly scheduledMailboxes = new Map<string, ReturnType<typeof setTimeout>>()

    constructor(
        private readonly executor: GatewayExecutorLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: GatewayMailboxConfig,
        private readonly interactions: GatewayInteractionRuntimeLike,
    ) {}

    start(): void {
        for (const mailboxKey of this.store.listPendingMailboxKeys()) {
            this.scheduleImmediate(mailboxKey)
        }
    }

    async enqueueInboundMessage(message: BindingInboundMessage, sourceKind: string, externalId: string): Promise<void> {
        if (await this.interactions.tryHandleInboundMessage(message)) {
            return
        }

        const prepared = this.executor.prepareInboundMessage(message)
        const recordedAtMs = Date.now()

        this.store.enqueueMailboxEntry({
            mailboxKey: prepared.conversationKey,
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

        this.scheduleAfterEnqueue(prepared.conversationKey)
    }

    private scheduleAfterEnqueue(mailboxKey: string): void {
        if (this.activeMailboxes.has(mailboxKey) || this.scheduledMailboxes.has(mailboxKey)) {
            return
        }

        this.schedule(mailboxKey, this.config.batchReplies ? this.config.batchWindowMs : 0)
    }

    private scheduleImmediate(mailboxKey: string): void {
        if (this.activeMailboxes.has(mailboxKey) || this.scheduledMailboxes.has(mailboxKey)) {
            return
        }

        this.schedule(mailboxKey, 0)
    }

    private scheduleRetry(mailboxKey: string): void {
        if (this.activeMailboxes.has(mailboxKey) || this.scheduledMailboxes.has(mailboxKey)) {
            return
        }

        this.schedule(mailboxKey, RETRY_DELAY_MS)
    }

    private schedule(mailboxKey: string, delayMs: number): void {
        const handle = setTimeout(() => {
            this.scheduledMailboxes.delete(mailboxKey)
            void this.processMailbox(mailboxKey)
        }, delayMs)
        this.scheduledMailboxes.set(mailboxKey, handle)
    }

    private async processMailbox(mailboxKey: string): Promise<void> {
        if (this.activeMailboxes.has(mailboxKey)) {
            return
        }

        this.activeMailboxes.add(mailboxKey)

        try {
            const entries = this.store.listMailboxEntries(mailboxKey)
            if (entries.length === 0) {
                return
            }

            const batch = this.config.batchReplies ? entries : [entries[0]]
            await this.executor.executeMailboxEntries(batch)
            this.store.deleteMailboxEntries(batch.map((entry) => entry.id))
            await deleteInboundAttachmentFiles(batch, this.logger)
        } catch (error) {
            this.logger.log("warn", `mailbox flush failed for ${mailboxKey}: ${formatError(error)}`)
            this.scheduleRetry(mailboxKey)
            return
        } finally {
            this.activeMailboxes.delete(mailboxKey)
        }

        if (this.store.listMailboxEntries(mailboxKey).length > 0) {
            this.scheduleImmediate(mailboxKey)
        }
    }
}

type GatewayExecutorLike = Pick<GatewayExecutor, "executeMailboxEntries" | "prepareInboundMessage">
type GatewayInteractionRuntimeLike = Pick<GatewayInteractionRuntime, "tryHandleInboundMessage">

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
