import type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingPromptRequest,
    BindingRuntimeReport,
} from "../binding"
import type { GatewayTextDelivery, TextDeliverySession } from "../delivery/text"
import type { GatewayOpencodeHost } from "../host/opencode"
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"

type PromptExecutionPlan = {
    conversationKey: string
    prompt: string
    replyTarget: BindingDeliveryTarget | null
}

export class GatewayExecutor {
    constructor(
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeHostLike,
        private readonly delivery: GatewayTextDeliveryLike,
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
        const persistedSessionId = this.store.getSessionBinding(plan.conversationKey)
        const deliverySession = plan.replyTarget === null ? null : await this.delivery.open(plan.replyTarget, "auto")
        const promptResult = await this.executePromptWithRecovery(plan, persistedSessionId, deliverySession)

        const nextSessionId = normalizeRequiredField(promptResult.sessionId, "opencode session id")
        this.store.putSessionBinding(plan.conversationKey, nextSessionId, recordedAtMs)

        let delivered = false
        if (deliverySession !== null) {
            delivered = await deliverySession.finish(promptResult.responseText)
            this.store.appendJournal(
                createJournalEntry("delivery", recordedAtMs, plan.conversationKey, {
                    deliveryTarget: plan.replyTarget,
                    body: promptResult.responseText,
                }),
            )
        }

        return {
            conversationKey: plan.conversationKey,
            responseText: promptResult.responseText,
            delivered,
            recordedAtMs: BigInt(recordedAtMs),
        }
    }

    private async executePromptWithRecovery(
        plan: PromptExecutionPlan,
        persistedSessionId: string | null,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<{ sessionId: string; responseText: string }> {
        try {
            return await this.executePrompt(plan, persistedSessionId, deliverySession)
        } catch (error) {
            if (persistedSessionId === null || !isMissingSessionBindingError(error)) {
                throw error
            }

            this.logger.log(
                "warn",
                `stale opencode session binding detected for ${plan.conversationKey}; recreating session`,
            )
            this.store.deleteSessionBinding(plan.conversationKey)

            return await this.executePrompt(plan, null, deliverySession)
        }
    }

    private async executePrompt(
        plan: PromptExecutionPlan,
        sessionId: string | null,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<{ sessionId: string; responseText: string }> {
        const request: BindingPromptRequest = {
            conversationKey: plan.conversationKey,
            prompt: plan.prompt,
            sessionId,
        }

        return deliverySession?.mode === "progressive"
            ? await this.opencode.runPromptWithSnapshots(request, async (snapshot) => {
                  await deliverySession.preview(snapshot)
              })
            : await runPromptOnce(this.opencode, request)
    }
}

export type GatewayExecutorLike = Pick<GatewayExecutor, "handleInboundMessage" | "dispatchCronJob">

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "open">
type GatewayOpencodeHostLike = Pick<GatewayOpencodeHost, "runPrompt" | "runPromptWithSnapshots">
type TextDeliverySessionLike = Pick<TextDeliverySession, "mode" | "preview">

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

async function runPromptOnce(
    opencode: GatewayOpencodeHostLike,
    request: BindingPromptRequest,
): Promise<{ sessionId: string; responseText: string }> {
    const promptResult = await opencode.runPrompt(request)
    if (promptResult.errorMessage !== null) {
        throw new Error(promptResult.errorMessage)
    }

    return {
        sessionId: normalizeRequiredField(promptResult.sessionId ?? "", "opencode session id"),
        responseText: promptResult.responseText,
    }
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
