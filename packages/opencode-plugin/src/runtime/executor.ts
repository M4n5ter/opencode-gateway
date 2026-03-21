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
import type { RuntimeJournalEntry, SqliteStore } from "../store/sqlite"

const DEFAULT_FLUSH_INTERVAL_MS = 400

export class GatewayExecutor {
    constructor(
        private readonly module: GatewayBindingModule,
        private readonly store: SqliteStore,
        private readonly opencode: GatewayOpencodeHostLike,
        private readonly delivery: GatewayTextDeliveryLike,
        private readonly logger: BindingLoggerHost,
    ) {}

    async handleInboundMessage(message: BindingInboundMessage): Promise<BindingRuntimeReport> {
        const prepared = this.module.prepareInboundExecution(message)
        const sender = normalizeRequiredField(message.sender, "message sender")
        const recordedAtMs = Date.now()

        this.logger.log("info", "handling inbound gateway message")
        this.store.appendJournal(
            createJournalEntry("inbound_message", recordedAtMs, prepared.conversationKey, {
                deliveryTarget: prepared.replyTarget,
                sender,
                body: prepared.prompt,
            }),
        )

        return await this.executePrepared(prepared, recordedAtMs)
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

        return await this.executePrepared(prepared, recordedAtMs)
    }

    private async executePrepared(
        prepared: BindingPreparedExecution,
        recordedAtMs: number,
    ): Promise<BindingRuntimeReport> {
        const persistedSessionId = this.store.getSessionBinding(prepared.conversationKey)
        const deliverySession =
            prepared.replyTarget === null ? null : await this.delivery.open(prepared.replyTarget, "auto")
        const promptResult = await this.executePromptWithRecovery(prepared, persistedSessionId, deliverySession)

        this.store.putSessionBinding(prepared.conversationKey, promptResult.sessionId, recordedAtMs)

        let delivered = false
        if (deliverySession !== null) {
            delivered = await deliverySession.finish(promptResult.finalText)
            if (promptResult.finalText !== null) {
                this.store.appendJournal(
                    createJournalEntry("delivery", recordedAtMs, prepared.conversationKey, {
                        deliveryTarget: prepared.replyTarget,
                        body: promptResult.finalText,
                    }),
                )
            }
        }

        return {
            conversationKey: prepared.conversationKey,
            responseText: promptResult.responseText,
            delivered,
            recordedAtMs: BigInt(recordedAtMs),
        }
    }

    private async executePromptWithRecovery(
        prepared: BindingPreparedExecution,
        persistedSessionId: string | null,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<PromptExecutionResult> {
        const sessionId = await this.opencode.ensureSession(prepared.conversationKey, persistedSessionId)

        try {
            return await this.executePrompt(prepared, sessionId, deliverySession)
        } catch (error) {
            if (persistedSessionId === null || !isMissingSessionBindingError(error)) {
                throw error
            }

            this.logger.log(
                "warn",
                `stale opencode session binding detected for ${prepared.conversationKey}; recreating session`,
            )
            this.store.deleteSessionBinding(prepared.conversationKey)

            const freshSessionId = await this.opencode.ensureSession(prepared.conversationKey, null)
            return await this.executePrompt(prepared, freshSessionId, deliverySession)
        }
    }

    private async executePrompt(
        prepared: BindingPreparedExecution,
        sessionId: string,
        deliverySession: TextDeliverySessionLike | null,
    ): Promise<PromptExecutionResult> {
        const execution =
            deliverySession?.mode === "progressive"
                ? this.module.ExecutionHandle.progressive(prepared, sessionId, DEFAULT_FLUSH_INTERVAL_MS)
                : this.module.ExecutionHandle.oneshot(prepared, sessionId, DEFAULT_FLUSH_INTERVAL_MS)

        try {
            const responseText =
                deliverySession?.mode === "progressive"
                    ? await this.opencode.promptSessionWithSnapshots(
                          sessionId,
                          prepared.prompt,
                          execution,
                          async (snapshot) => {
                              await deliverySession.preview(snapshot)
                          },
                      )
                    : await this.opencode.promptSession(sessionId, prepared.prompt)
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

export type GatewayExecutorLike = Pick<GatewayExecutor, "handleInboundMessage" | "dispatchCronJob">

type PromptExecutionResult = {
    sessionId: string
    responseText: string
    finalText: string | null
}

type GatewayTextDeliveryLike = Pick<GatewayTextDelivery, "open">
type GatewayOpencodeHostLike = Pick<
    GatewayOpencodeHost,
    "ensureSession" | "promptSession" | "promptSessionWithSnapshots"
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
