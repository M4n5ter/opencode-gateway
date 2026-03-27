import type {
    BindingDeferredDeliveryStrategy,
    BindingHostAck,
    BindingOutboundMessage,
    BindingTransportHost,
} from "../binding"
import type { SqliteStore } from "../store/sqlite"
import type { TelegramDeliveryClientLike } from "../telegram/client"
import { recordTelegramSendFailure, recordTelegramSendSuccess } from "../telegram/state"
import { renderTelegramFinalMessage, renderTelegramStreamMessage } from "../telegram/stream-render"
import { formatError } from "../utils/error"

export class GatewayTransportHost implements BindingTransportHost {
    constructor(
        private readonly telegramClient: TelegramDeliveryClientLike | null,
        private readonly store: SqliteStore,
    ) {}

    async sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck> {
        return await this.deliverMessage(message, { mode: "send" })
    }

    async deliverMessage(
        message: BindingOutboundMessage,
        strategy: BindingDeferredDeliveryStrategy = { mode: "send" },
    ): Promise<BindingHostAck> {
        try {
            if (message.deliveryTarget.channel !== "telegram") {
                throw new Error(`unsupported outbound channel: ${message.deliveryTarget.channel}`)
            }

            if (this.telegramClient === null) {
                throw new Error("telegram transport is not configured")
            }

            const body = message.body.trim()
            if (body.length === 0) {
                throw new Error("telegram outbound message body must not be empty")
            }

            const rendered = renderOutboundBody(message)
            if (strategy.mode === "send") {
                await this.telegramClient.sendMessage(
                    message.deliveryTarget.target,
                    rendered,
                    message.deliveryTarget.topic,
                    {
                        parseMode: "HTML",
                    },
                )
            } else {
                await this.telegramClient.editMessageText(message.deliveryTarget.target, strategy.messageId, rendered, {
                    parseMode: "HTML",
                })
            }
            recordTelegramSendSuccess(this.store, Date.now())
            return {
                kind: "delivered",
            }
        } catch (error) {
            const ack = classifyTelegramDeliveryFailure(error, strategy)
            if (ack.kind === "delivered") {
                recordTelegramSendSuccess(this.store, Date.now())
                return ack
            }

            recordTelegramSendFailure(this.store, ack.errorMessage, Date.now())
            return ack
        }
    }
}

function renderOutboundBody(message: BindingOutboundMessage): string {
    const previewContext = message.previewContext ?? null
    if (previewContext === null) {
        return renderTelegramFinalMessage(message.body)
    }

    return renderTelegramStreamMessage({
        processText: previewContext.processText,
        reasoningText: previewContext.reasoningText,
        answerText: message.body,
    })
}

function classifyTelegramDeliveryFailure(error: unknown, strategy: BindingDeferredDeliveryStrategy): BindingHostAck {
    const errorMessage = formatError(error)
    if (strategy.mode === "edit") {
        const normalized = errorMessage.toLowerCase()
        if (normalized.includes("message is not modified")) {
            return {
                kind: "delivered",
            }
        }

        if (normalized.includes("message to edit not found") || normalized.includes("message can't be edited")) {
            return {
                kind: "permanent_edit_failure",
                errorMessage,
            }
        }
    }

    return {
        kind: "retryable_failure",
        errorMessage,
    }
}
