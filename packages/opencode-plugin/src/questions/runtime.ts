import type { BindingDeliveryTarget, BindingInboundMessage, BindingLoggerHost } from "../binding"
import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewaySessionContext } from "../session/context"
import type { SqliteStore } from "../store/sqlite"
import type { TelegramQuestionClientLike } from "../telegram/client"
import type { TelegramNormalizedCallbackQuery } from "../telegram/normalize"
import { recordTelegramSendFailure, recordTelegramSendSuccess } from "../telegram/state"
import type { TelegramInlineKeyboardMarkup } from "../telegram/types"
import { formatError } from "../utils/error"
import { formatPlainTextQuestion, formatQuestionReplyError } from "./format"
import { type GatewayQuestionEvent, normalizeQuestionEvent } from "./normalize"
import { parseQuestionReply } from "./parser"
import type { GatewayQuestionRequest, PendingQuestionRecord } from "./types"

type QuestionClientLike = {
    question: {
        reply(
            input: {
                requestID: string
                directory?: string
                answers?: string[][]
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
        reject(
            input: {
                requestID: string
                directory?: string
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
    }
}

export class GatewayQuestionRuntime {
    constructor(
        private readonly client: QuestionClientLike,
        private readonly directory: string,
        private readonly store: SqliteStore,
        private readonly sessions: GatewaySessionContext,
        private readonly transport: QuestionTransportLike,
        private readonly telegramClient: TelegramQuestionClientLike | null,
        private readonly logger: BindingLoggerHost,
    ) {}

    handleEvent(event: OpencodeRuntimeEvent): void {
        const normalized = normalizeQuestionEvent(event)
        if (normalized === null) {
            return
        }

        void this.processEvent(normalized).catch((error) => {
            this.logger.log("warn", `question bridge failed: ${formatError(error)}`)
        })
    }

    async tryHandleInboundMessage(message: BindingInboundMessage): Promise<boolean> {
        const pending = this.store.getPendingQuestionForTarget(message.deliveryTarget)
        if (pending === null) {
            return false
        }

        const parsed = parseQuestionReply(pending, message.text)
        switch (parsed.kind) {
            case "invalid":
                await this.sendPlainText(pending.deliveryTarget, formatQuestionReplyError(pending, parsed.message))
                return true
            case "reject":
                await this.rejectQuestion(pending.requestId)
                this.store.deletePendingQuestion(pending.requestId)
                return true
            case "reply":
                await this.replyQuestion(pending.requestId, parsed.answers)
                this.store.deletePendingQuestion(pending.requestId)
                return true
        }
    }

    async handleTelegramCallbackQuery(query: TelegramNormalizedCallbackQuery): Promise<boolean> {
        if (this.telegramClient === null) {
            return false
        }

        const pending = this.store.getPendingQuestionForTelegramMessage(query.deliveryTarget, query.messageId)
        if (pending === null) {
            await this.telegramClient.answerCallbackQuery(query.callbackQueryId, "This question is no longer pending.")
            return true
        }

        const answer = resolveCallbackAnswer(query.data, pending)
        if (answer === null) {
            await this.telegramClient.answerCallbackQuery(query.callbackQueryId, "This button is no longer valid.")
            return true
        }

        await this.replyQuestion(pending.requestId, [[answer]])
        this.store.deletePendingQuestion(pending.requestId)
        await this.telegramClient.answerCallbackQuery(query.callbackQueryId, `Sent: ${answer}`)
        return true
    }

    private async processEvent(event: GatewayQuestionEvent): Promise<void> {
        switch (event.kind) {
            case "asked":
                await this.handleQuestionAsked(event.request)
                return
            case "resolved":
                this.store.deletePendingQuestion(event.requestId)
                return
        }
    }

    private async handleQuestionAsked(request: GatewayQuestionRequest): Promise<void> {
        const targets = this.sessions.listReplyTargets(request.sessionId)
        if (targets.length === 0) {
            this.logger.log(
                "warn",
                `question ${request.requestId} has no reply target for session ${request.sessionId}`,
            )
            return
        }

        const deliveredTargets: Array<{
            deliveryTarget: BindingDeliveryTarget
            telegramMessageId: number | null
        }> = []

        for (const target of targets) {
            try {
                deliveredTargets.push(await this.sendQuestion(target, request))
            } catch (error) {
                this.logger.log(
                    "warn",
                    `question ${request.requestId} delivery failed for ${target.channel}:${target.target}: ${formatError(error)}`,
                )
            }
        }

        if (deliveredTargets.length === 0) {
            return
        }

        this.store.replacePendingQuestion({
            requestId: request.requestId,
            sessionId: request.sessionId,
            questions: request.questions,
            targets: deliveredTargets,
            recordedAtMs: Date.now(),
        })
    }

    private async sendQuestion(
        target: BindingDeliveryTarget,
        request: GatewayQuestionRequest,
    ): Promise<{
        deliveryTarget: BindingDeliveryTarget
        telegramMessageId: number | null
    }> {
        const nativeKeyboard = buildTelegramInlineKeyboard(request)
        if (target.channel === "telegram" && nativeKeyboard !== null && this.telegramClient !== null) {
            try {
                const sent = await this.telegramClient.sendInteractiveMessage(
                    target.target,
                    formatTelegramNativeQuestion(request),
                    target.topic,
                    nativeKeyboard,
                )
                recordTelegramSendSuccess(this.store, Date.now())
                return {
                    deliveryTarget: target,
                    telegramMessageId: sent.message_id,
                }
            } catch (error) {
                recordTelegramSendFailure(this.store, formatError(error), Date.now())
                throw error
            }
        }

        await this.sendPlainText(target, formatPlainTextQuestion(request))
        return {
            deliveryTarget: target,
            telegramMessageId: null,
        }
    }

    private async sendPlainText(target: BindingDeliveryTarget, body: string): Promise<void> {
        const ack = await this.transport.sendMessage({
            deliveryTarget: target,
            body,
        })
        if (ack.errorMessage !== null) {
            throw new Error(ack.errorMessage)
        }
    }

    private async replyQuestion(requestId: string, answers: string[][]): Promise<void> {
        await this.client.question.reply(
            {
                requestID: requestId,
                directory: this.directory,
                answers,
            },
            {
                responseStyle: "data",
                throwOnError: true,
            },
        )
    }

    private async rejectQuestion(requestId: string): Promise<void> {
        await this.client.question.reject(
            {
                requestID: requestId,
                directory: this.directory,
            },
            {
                responseStyle: "data",
                throwOnError: true,
            },
        )
    }
}

function buildTelegramInlineKeyboard(request: GatewayQuestionRequest): TelegramInlineKeyboardMarkup | null {
    if (request.questions.length !== 1) {
        return null
    }

    const [question] = request.questions
    if (question.multiple || question.options.length === 0) {
        return null
    }

    return {
        inline_keyboard: question.options.map((option, index) => [
            {
                text: option.label,
                callback_data: `q:${index}`,
            },
        ]),
    }
}

function formatTelegramNativeQuestion(request: GatewayQuestionRequest): string {
    const [question] = request.questions
    return [
        "OpenCode needs additional input before it can continue.",
        "",
        `${question.header}: ${question.question}`,
        "",
        "Tap a button below or reply with text.",
    ].join("\n")
}

function resolveCallbackAnswer(data: string | null, pending: PendingQuestionRecord): string | null {
    if (data === null || !data.startsWith("q:") || pending.questions.length !== 1) {
        return null
    }

    const indexText = data.slice(2)
    const index = Number.parseInt(indexText, 10)
    if (!Number.isSafeInteger(index) || index < 0) {
        return null
    }

    return pending.questions[0]?.options[index]?.label ?? null
}

type QuestionTransportLike = {
    sendMessage(input: { deliveryTarget: BindingDeliveryTarget; body: string }): Promise<{
        errorMessage: string | null
    }>
}
