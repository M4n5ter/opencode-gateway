import type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingHostAck,
    BindingInboundMessage,
    BindingOutboundMessage,
    BindingSessionBinding,
    BindingStoreHost,
} from "../binding"
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { failedAck, failedSessionBinding, okAck, okSessionBinding } from "./result"

export class SqliteStoreHost implements BindingStoreHost {
    constructor(private readonly store: SqliteStore) {}

    async getSessionBinding(conversationKey: string): Promise<BindingSessionBinding> {
        try {
            return okSessionBinding(this.store.getSessionBinding(conversationKey))
        } catch (error) {
            return failedSessionBinding(error)
        }
    }

    async putSessionBinding(conversationKey: string, sessionId: string, recordedAtMs: bigint): Promise<BindingHostAck> {
        try {
            this.store.putSessionBinding(conversationKey, sessionId, toRecordedAtMs(recordedAtMs))
            return okAck()
        } catch (error) {
            return failedAck(error)
        }
    }

    async recordInboundMessage(message: BindingInboundMessage, recordedAtMs: bigint): Promise<BindingHostAck> {
        try {
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
            return okAck()
        } catch (error) {
            return failedAck(error)
        }
    }

    async recordCronDispatch(job: BindingCronJobSpec, recordedAtMs: bigint): Promise<BindingHostAck> {
        const conversationKey = `cron:${job.id.trim()}`

        try {
            this.store.appendJournal(
                createJournalEntry("cron_dispatch", toRecordedAtMs(recordedAtMs), conversationKey, {
                    id: job.id,
                    schedule: job.schedule,
                    prompt: job.prompt,
                }),
            )
            return okAck()
        } catch (error) {
            return failedAck(error)
        }
    }

    async recordDelivery(message: BindingOutboundMessage, recordedAtMs: bigint): Promise<BindingHostAck> {
        try {
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
            return okAck()
        } catch (error) {
            return failedAck(error)
        }
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
