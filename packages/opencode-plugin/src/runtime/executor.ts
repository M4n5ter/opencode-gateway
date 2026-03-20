import type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingRuntimeReport,
} from "../binding"
import type { GatewayOpencodeHost } from "../host/opencode"
import type { GatewayTransportHost } from "../host/transport"
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"

type PromptExecutionPlan = {
    conversationKey: string
    prompt: string
    replyTarget: BindingDeliveryTarget | null
}

export class GatewayExecutor {
    constructor(
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeHost,
        private readonly transport: GatewayTransportHost,
        private readonly logger: BindingLoggerHost,
    ) {}

    async handleInboundMessage(message: BindingInboundMessage): Promise<BindingRuntimeReport> {
        const normalizedTarget = normalizeDeliveryTarget(message.deliveryTarget)
        const sender = normalizeRequiredField(message.sender, "message sender")
        const body = normalizeRequiredField(message.body, "message body")
        const recordedAtMs = Date.now()

        this.logger.log("info", "handling inbound gateway message")
        this.store.appendJournal(
            createJournalEntry("inbound_message", recordedAtMs, conversationKeyForTarget(normalizedTarget), {
                deliveryTarget: normalizedTarget,
                sender,
                body,
            }),
        )

        return await this.executePlan(
            {
                conversationKey: conversationKeyForTarget(normalizedTarget),
                prompt: body,
                replyTarget: normalizedTarget,
            },
            recordedAtMs,
        )
    }

    async dispatchCronJob(job: BindingCronJobSpec): Promise<BindingRuntimeReport> {
        const normalized = normalizeCronJob(job)
        const recordedAtMs = Date.now()

        this.logger.log("info", "dispatching cron gateway job")
        this.store.appendJournal(
            createJournalEntry("cron_dispatch", recordedAtMs, normalized.conversationKey, {
                id: normalized.id,
                schedule: normalized.schedule,
                prompt: normalized.prompt,
                deliveryChannel: normalized.replyTarget?.channel ?? null,
                deliveryTarget: normalized.replyTarget?.target ?? null,
                deliveryTopic: normalized.replyTarget?.topic ?? null,
            }),
        )

        return await this.executePlan(
            {
                conversationKey: normalized.conversationKey,
                prompt: normalized.prompt,
                replyTarget: normalized.replyTarget,
            },
            recordedAtMs,
        )
    }

    private async executePlan(plan: PromptExecutionPlan, recordedAtMs: number): Promise<BindingRuntimeReport> {
        const sessionId = this.store.getSessionBinding(plan.conversationKey)
        const promptResult = await this.opencode.runPrompt({
            conversationKey: plan.conversationKey,
            prompt: plan.prompt,
            sessionId,
        })

        if (promptResult.errorMessage !== null) {
            throw new Error(promptResult.errorMessage)
        }

        const nextSessionId = normalizeRequiredField(promptResult.sessionId ?? "", "opencode session id")
        this.store.putSessionBinding(plan.conversationKey, nextSessionId, recordedAtMs)

        let delivered = false
        if (plan.replyTarget !== null) {
            const ack = await this.transport.sendMessage({
                deliveryTarget: plan.replyTarget,
                body: promptResult.responseText,
            })

            if (ack.errorMessage !== null) {
                throw new Error(ack.errorMessage)
            }

            this.store.appendJournal(
                createJournalEntry("delivery", recordedAtMs, plan.conversationKey, {
                    deliveryTarget: plan.replyTarget,
                    body: promptResult.responseText,
                }),
            )
            delivered = true
        }

        return {
            conversationKey: plan.conversationKey,
            responseText: promptResult.responseText,
            delivered,
            recordedAtMs: BigInt(recordedAtMs),
        }
    }
}

export type GatewayExecutorLike = Pick<GatewayExecutor, "handleInboundMessage" | "dispatchCronJob">

type NormalizedCronJob = {
    id: string
    schedule: string
    prompt: string
    conversationKey: string
    replyTarget: BindingDeliveryTarget | null
}

function normalizeCronJob(job: BindingCronJobSpec): NormalizedCronJob {
    const id = normalizeRequiredField(job.id, "cron job id")
    const schedule = normalizeRequiredField(job.schedule, "cron schedule")
    const prompt = normalizeRequiredField(job.prompt, "cron prompt")
    const replyTarget = normalizeOptionalDeliveryTarget(job.deliveryChannel, job.deliveryTarget, job.deliveryTopic)

    return {
        id,
        schedule,
        prompt,
        conversationKey: `cron:${id}`,
        replyTarget,
    }
}

function normalizeOptionalDeliveryTarget(
    channel: string | null,
    target: string | null,
    topic: string | null,
): BindingDeliveryTarget | null {
    if (channel === null && target === null) {
        if (normalizeOptionalField(topic) !== null) {
            throw new Error("cron deliveryTopic requires deliveryChannel and deliveryTarget")
        }

        return null
    }

    if (channel === null || target === null) {
        throw new Error("cron deliveryChannel and deliveryTarget must be provided together")
    }

    return normalizeDeliveryTarget({
        channel,
        target,
        topic,
    })
}

function normalizeDeliveryTarget(target: BindingDeliveryTarget): BindingDeliveryTarget {
    const channel = normalizeRequiredField(target.channel, "delivery channel")
    if (channel !== "telegram") {
        throw new Error(`unsupported channel kind: ${channel}`)
    }

    return {
        channel,
        target: normalizeRequiredField(target.target, "delivery target"),
        topic: normalizeOptionalField(target.topic),
    }
}

function conversationKeyForTarget(target: BindingDeliveryTarget): string {
    return target.topic === null
        ? `${target.channel}:${target.target}`
        : `${target.channel}:${target.target}:topic:${target.topic}`
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

function normalizeRequiredField(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function normalizeOptionalField(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}
