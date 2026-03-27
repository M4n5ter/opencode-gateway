import type { BindingDeliveryTarget, BindingHostAck, BindingInboundMessage, BindingLoggerHost } from "../binding"
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

type SessionHierarchyRecord = {
    id: string
    parentID?: string
}

type InteractionClientLike = {
    permission: {
        list(
            input: {
                directory?: string
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
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
        list(
            input: {
                directory?: string
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
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
    session: {
        get(
            input: {
                sessionID: string
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
    sendMessage(input: { deliveryTarget: BindingDeliveryTarget; body: string }): Promise<BindingHostAck>
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

    async reconcilePendingRequests(): Promise<void> {
        const [questions, permissions] = await Promise.all([this.listPendingQuestions(), this.listPendingPermissions()])

        for (const request of [...questions, ...permissions]) {
            if (this.store.hasPendingInteraction(request.requestId)) {
                continue
            }

            await this.handleInteractionAsked(request)
        }
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
        if (this.store.hasPendingInteraction(request.requestId)) {
            return
        }

        const targets = await this.resolveReplyTargets(request.sessionId)
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
        if (ack.kind !== "delivered") {
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

    private async resolveReplyTargets(sessionId: string): Promise<BindingDeliveryTarget[]> {
        const directTargets = this.sessions.listReplyTargets(sessionId)
        if (directTargets.length > 0) {
            return directTargets
        }

        const visited = new Set<string>([sessionId])
        let currentSessionId: string | null = sessionId

        while (currentSessionId !== null) {
            const parentSessionId = await this.readParentSessionId(currentSessionId)
            if (parentSessionId === null || visited.has(parentSessionId)) {
                return []
            }

            const inheritedTargets = this.sessions.listReplyTargets(parentSessionId)
            if (inheritedTargets.length > 0) {
                this.logger.log(
                    "debug",
                    `resolved interaction reply target via ancestor session ${parentSessionId} for ${sessionId}`,
                )
                return inheritedTargets
            }

            visited.add(parentSessionId)
            currentSessionId = parentSessionId
        }

        return []
    }

    private async readParentSessionId(sessionId: string): Promise<string | null> {
        try {
            const session = unwrapData<SessionHierarchyRecord>(
                await this.client.session.get(
                    {
                        sessionID: sessionId,
                        directory: this.directory,
                    },
                    {
                        responseStyle: "data",
                        throwOnError: true,
                    },
                ),
            )

            return session.parentID ?? null
        } catch (error) {
            this.logger.log("warn", `failed to inspect OpenCode session ${sessionId}: ${formatError(error)}`)
            return null
        }
    }

    private async listPendingQuestions(): Promise<GatewayInteractionRequest[]> {
        return unwrapData<QuestionListRecord[]>(
            await this.client.question.list(
                {
                    directory: this.directory,
                },
                {
                    responseStyle: "data",
                    throwOnError: true,
                },
            ),
        ).map((request) => ({
            kind: "question",
            requestId: request.id,
            sessionId: request.sessionID,
            questions: request.questions.map((question) => ({
                header: question.header,
                question: question.question,
                options: question.options.map((option) => ({
                    label: option.label,
                    description: option.description,
                })),
                multiple: question.multiple === true,
                custom: question.custom !== false,
            })),
        }))
    }

    private async listPendingPermissions(): Promise<GatewayInteractionRequest[]> {
        return unwrapData<PermissionListRecord[]>(
            await this.client.permission.list(
                {
                    directory: this.directory,
                },
                {
                    responseStyle: "data",
                    throwOnError: true,
                },
            ),
        ).map((request) => ({
            kind: "permission",
            requestId: request.id,
            sessionId: request.sessionID,
            permission: request.permission,
            patterns: [...request.patterns],
            metadata: request.metadata,
            always: [...request.always],
            tool:
                request.tool === undefined
                    ? null
                    : {
                          messageId: request.tool.messageID,
                          callId: request.tool.callID,
                      },
        }))
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

type QuestionListRecord = {
    id: string
    sessionID: string
    questions: Array<{
        header: string
        question: string
        options: Array<{
            label: string
            description: string
        }>
        multiple?: boolean
        custom?: boolean
    }>
}

type PermissionListRecord = {
    id: string
    sessionID: string
    permission: string
    patterns: string[]
    metadata: Record<string, unknown>
    always: string[]
    tool?: {
        messageID: string
        callID: string
    }
}

function unwrapData<T>(value: unknown): T {
    if (typeof value === "object" && value !== null && "data" in value) {
        return value.data as T
    }

    return value as T
}
