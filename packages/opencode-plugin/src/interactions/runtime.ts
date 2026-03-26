import type { BindingDeliveryTarget, BindingInboundMessage, BindingLoggerHost } from "../binding"
import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewaySessionContext } from "../session/context"
import type { SqliteStore } from "../store/sqlite"
import type { TelegramInteractionClientLike } from "../telegram/client"
import type { TelegramNormalizedCallbackQuery } from "../telegram/normalize"
import { recordTelegramSendFailure, recordTelegramSendSuccess } from "../telegram/state"
import type { TelegramInlineKeyboardMarkup } from "../telegram/types"
import { formatError } from "../utils/error"
import { type GatewayInteractionEvent, normalizeInteractionEvent } from "./normalize"
import {
    buildTelegramPermissionKeyboard,
    formatPermissionCallbackAck,
    formatPermissionReplyError,
    formatPlainTextPermission,
    formatTelegramPermission,
    parsePermissionReply,
    resolvePermissionCallbackReply,
} from "./permission"
import {
    buildTelegramQuestionKeyboard,
    formatPlainTextQuestion,
    formatQuestionReplyError,
    formatTelegramQuestion,
    parseQuestionReply,
    resolveQuestionCallbackAnswer,
} from "./question"
import type { GatewayInteractionRequest, GatewayPermissionReply, PendingInteractionRecord } from "./types"

type InteractionClientLike = {
    permission: {
        reply(
            input: {
                requestID: string
                directory?: string
                reply?: GatewayPermissionReply
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
    }
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

type QuestionTransportLike = {
    sendMessage(input: { deliveryTarget: BindingDeliveryTarget; body: string }): Promise<{
        errorMessage: string | null
    }>
}

type TelegramInteractiveRequest = {
    text: string
    replyMarkup: TelegramInlineKeyboardMarkup
    parseMode?: "HTML" | "MarkdownV2" | "Markdown"
}

export class GatewayInteractionRuntime {
    constructor(
        private readonly client: InteractionClientLike,
        private readonly directory: string,
        private readonly store: SqliteStore,
        private readonly sessions: GatewaySessionContext,
        private readonly transport: QuestionTransportLike,
        private readonly telegramClient: TelegramInteractionClientLike | null,
        private readonly logger: BindingLoggerHost,
    ) {}

    handleEvent(event: OpencodeRuntimeEvent): void {
        const normalized = normalizeInteractionEvent(event)
        if (normalized === null) {
            return
        }

        void this.processEvent(normalized).catch((error) => {
            this.logger.log("warn", `interaction bridge failed: ${formatError(error)}`)
        })
    }

    async tryHandleInboundMessage(message: BindingInboundMessage): Promise<boolean> {
        const pending = this.store.getPendingInteractionForTarget(message.deliveryTarget)
        if (pending === null) {
            return false
        }

        switch (pending.kind) {
            case "question":
                return await this.tryHandleQuestionReply(pending, message)
            case "permission":
                return await this.tryHandlePermissionReply(pending, message)
        }
    }

    async handleTelegramCallbackQuery(query: TelegramNormalizedCallbackQuery): Promise<boolean> {
        if (this.telegramClient === null) {
            return false
        }

        const pending = this.store.getPendingInteractionForTelegramMessage(query.deliveryTarget, query.messageId)
        if (pending === null) {
            await this.telegramClient.answerCallbackQuery(query.callbackQueryId, "This request is no longer pending.")
            return true
        }

        switch (pending.kind) {
            case "question":
                return await this.handleQuestionCallbackQuery(pending, query)
            case "permission":
                return await this.handlePermissionCallbackQuery(pending, query)
        }
    }

    private async processEvent(event: GatewayInteractionEvent): Promise<void> {
        switch (event.kind) {
            case "asked":
                await this.handleInteractionAsked(event.request)
                return
            case "resolved":
                this.store.deletePendingInteraction(event.requestId)
                return
        }
    }

    private async handleInteractionAsked(request: GatewayInteractionRequest): Promise<void> {
        const targets = this.sessions.listReplyTargets(request.sessionId)
        if (targets.length === 0) {
            this.logger.log(
                "warn",
                `${request.kind} ${request.requestId} has no reply target for session ${request.sessionId}`,
            )
            return
        }

        const deliveredTargets: Array<{
            deliveryTarget: BindingDeliveryTarget
            telegramMessageId: number | null
        }> = []

        for (const target of targets) {
            try {
                deliveredTargets.push(await this.sendInteraction(target, request))
            } catch (error) {
                this.logger.log(
                    "warn",
                    `${request.kind} ${request.requestId} delivery failed for ${target.channel}:${target.target}: ${formatError(error)}`,
                )
            }
        }

        if (deliveredTargets.length === 0) {
            return
        }

        this.store.replacePendingInteraction({
            request,
            targets: deliveredTargets,
            recordedAtMs: Date.now(),
        })
    }

    private async sendInteraction(
        target: BindingDeliveryTarget,
        request: GatewayInteractionRequest,
    ): Promise<{
        deliveryTarget: BindingDeliveryTarget
        telegramMessageId: number | null
    }> {
        const interactive = this.buildTelegramInteractiveRequest(request)
        if (target.channel === "telegram" && interactive !== null && this.telegramClient !== null) {
            try {
                const sent = await this.telegramClient.sendInteractiveMessage(
                    target.target,
                    interactive.text,
                    target.topic,
                    interactive.replyMarkup,
                    interactive.parseMode === undefined ? {} : { parseMode: interactive.parseMode },
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

        await this.sendPlainText(target, formatPlainTextInteraction(request))
        return {
            deliveryTarget: target,
            telegramMessageId: null,
        }
    }

    private buildTelegramInteractiveRequest(request: GatewayInteractionRequest): TelegramInteractiveRequest | null {
        switch (request.kind) {
            case "question": {
                const replyMarkup = buildTelegramQuestionKeyboard(request)
                if (replyMarkup === null) {
                    return null
                }

                return {
                    text: formatTelegramQuestion(request),
                    replyMarkup,
                }
            }
            case "permission":
                return {
                    text: formatTelegramPermission(request),
                    replyMarkup: buildTelegramPermissionKeyboard(request),
                    parseMode: "HTML",
                }
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

    private async tryHandleQuestionReply(
        pending: Extract<PendingInteractionRecord, { kind: "question" }>,
        message: BindingInboundMessage,
    ): Promise<boolean> {
        const parsed = parseQuestionReply(pending, message.text)
        switch (parsed.kind) {
            case "invalid":
                await this.sendPlainText(pending.deliveryTarget, formatQuestionReplyError(pending, parsed.message))
                return true
            case "reject":
                await this.rejectQuestion(pending.requestId)
                this.store.deletePendingInteraction(pending.requestId)
                return true
            case "reply":
                await this.replyQuestion(pending.requestId, parsed.answers)
                this.store.deletePendingInteraction(pending.requestId)
                return true
        }
    }

    private async tryHandlePermissionReply(
        pending: Extract<PendingInteractionRecord, { kind: "permission" }>,
        message: BindingInboundMessage,
    ): Promise<boolean> {
        const parsed = parsePermissionReply(pending, message.text)
        if (parsed.kind === "invalid") {
            await this.sendPlainText(pending.deliveryTarget, formatPermissionReplyError(pending, parsed.message))
            return true
        }

        await this.replyPermission(pending.requestId, parsed.reply)
        this.store.deletePendingInteraction(pending.requestId)
        return true
    }

    private async handleQuestionCallbackQuery(
        pending: Extract<PendingInteractionRecord, { kind: "question" }>,
        query: TelegramNormalizedCallbackQuery,
    ): Promise<boolean> {
        if (this.telegramClient === null) {
            return false
        }

        const answer = resolveQuestionCallbackAnswer(query.data, pending)
        if (answer === null) {
            await this.telegramClient.answerCallbackQuery(query.callbackQueryId, "This button is no longer valid.")
            return true
        }

        await this.replyQuestion(pending.requestId, [[answer]])
        this.store.deletePendingInteraction(pending.requestId)
        await this.telegramClient.answerCallbackQuery(query.callbackQueryId, `Sent: ${answer}`)
        return true
    }

    private async handlePermissionCallbackQuery(
        pending: Extract<PendingInteractionRecord, { kind: "permission" }>,
        query: TelegramNormalizedCallbackQuery,
    ): Promise<boolean> {
        if (this.telegramClient === null) {
            return false
        }

        const reply = resolvePermissionCallbackReply(query.data, pending)
        if (reply === null) {
            await this.telegramClient.answerCallbackQuery(query.callbackQueryId, "This button is no longer valid.")
            return true
        }

        await this.replyPermission(pending.requestId, reply)
        this.store.deletePendingInteraction(pending.requestId)
        await this.telegramClient.answerCallbackQuery(query.callbackQueryId, formatPermissionCallbackAck(reply))
        return true
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

    private async replyPermission(requestId: string, reply: GatewayPermissionReply): Promise<void> {
        await this.client.permission.reply(
            {
                requestID: requestId,
                directory: this.directory,
                reply,
            },
            {
                responseStyle: "data",
                throwOnError: true,
            },
        )
    }
}

function formatPlainTextInteraction(request: GatewayInteractionRequest): string {
    switch (request.kind) {
        case "question":
            return formatPlainTextQuestion(request)
        case "permission":
            return formatPlainTextPermission(request)
    }
}
