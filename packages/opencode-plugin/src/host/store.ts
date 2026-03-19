import type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingInboundMessage,
    BindingOutboundMessage,
    BindingStoreHost,
} from "../binding"
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"

export class SqliteStoreHost implements BindingStoreHost {
    constructor(private readonly store: SqliteStore) {}

    async getSessionBinding(conversationKey: string): Promise<string | null> {
        return this.store.getSessionBinding(conversationKey)
    }

    async putSessionBinding(conversationKey: string, sessionId: string, recordedAtMs: bigint): Promise<void> {
        this.store.putSessionBinding(conversationKey, sessionId, toRecordedAtMs(recordedAtMs))
    }

    async recordInboundMessage(message: BindingInboundMessage, recordedAtMs: bigint): Promise<void> {
        this.store.appendJournal(
            createJournalEntry(
                "inbound_message",
                toRecordedAtMs(recordedAtMs),
                conversationKeyForTarget(message.deliveryTarget),
                {
                    deliveryTarget: message.deliveryTarget,
                    sender: message.sender,
                    body: message.body,
                },
            ),
        )
    }

    async recordCronDispatch(job: BindingCronJobSpec, recordedAtMs: bigint): Promise<void> {
        const conversationKey = `cron:${job.id.trim()}`

        this.store.appendJournal(
            createJournalEntry("cron_dispatch", toRecordedAtMs(recordedAtMs), conversationKey, {
                id: job.id,
                schedule: job.schedule,
                prompt: job.prompt,
            }),
        )
    }

    async recordDelivery(message: BindingOutboundMessage, recordedAtMs: bigint): Promise<void> {
        this.store.appendJournal(
            createJournalEntry(
                "delivery",
                toRecordedAtMs(recordedAtMs),
                conversationKeyForTarget(message.deliveryTarget),
                {
                    deliveryTarget: message.deliveryTarget,
                    body: message.body,
                },
            ),
        )
    }
}

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

function conversationKeyForTarget(target: BindingDeliveryTarget): string {
    const base = `${target.channel}:${target.target}`
    const topic = normalizeTopic(target.topic)

    if (topic === null) {
        return base
    }

    return `${base}:topic:${topic}`
}

function normalizeTopic(topic: string | null): string | null {
    if (topic === null) {
        return null
    }

    const trimmed = topic.trim()
    return trimmed.length === 0 ? null : trimmed
}

function toRecordedAtMs(value: bigint): number {
    const recordedAtMs = Number(value)

    if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) {
        throw new Error(`recordedAtMs is out of range for JavaScript: ${value}`)
    }

    return recordedAtMs
}
