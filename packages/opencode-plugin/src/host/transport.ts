import type {
    BindingDeferredDeliveryStrategy,
    BindingHostAck,
    BindingOutboundMessage,
    BindingTransportHost,
} from "../binding"
import type { TelegramToolCallView } from "../config/telegram"
import type { SqliteStore } from "../store/sqlite"
import type { TelegramDeliveryClientLike } from "../telegram/client"
import { recordTelegramSendFailure, recordTelegramSendSuccess } from "../telegram/state"
import {
    buildTelegramStreamReplyMarkup,
    renderTelegramFinalMessage,
    renderTelegramStreamMessageForView,
    resolveTelegramPreviewViewState,
    type TelegramPreviewViewState,
} from "../telegram/stream-render"
import { formatError } from "../utils/error"

export class GatewayTransportHost implements BindingTransportHost {
    constructor(
        private readonly telegramClient: TelegramDeliveryClientLike | null,
        private readonly store: SqliteStore,
        private readonly toolCallView: TelegramToolCallView = "toggle",
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

            const rendered = this.renderOutboundMessage(message, strategy)
            if (strategy.mode === "send") {
                await this.telegramClient.sendMessage(
                    message.deliveryTarget.target,
                    rendered.text,
                    message.deliveryTarget.topic,
                    {
                        parseMode: "HTML",
                        replyMarkup: rendered.replyMarkup,
                    },
                )
            } else {
                await this.telegramClient.editMessageText(
                    message.deliveryTarget.target,
                    strategy.messageId,
                    rendered.text,
                    {
                        parseMode: "HTML",
                        replyMarkup: rendered.replyMarkup,
                    },
                )
            }
            this.syncPreviewMessageState(message, strategy)
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

    private renderOutboundMessage(
        message: BindingOutboundMessage,
        strategy: BindingDeferredDeliveryStrategy,
    ): { text: string; replyMarkup: ReturnType<typeof buildTelegramStreamReplyMarkup> } {
        const previewContext = message.previewContext ?? null
        if (previewContext === null) {
            return {
                text: renderTelegramFinalMessage(message.body),
                replyMarkup: null,
            }
        }

        const storedViewState = this.resolveStoredViewState(message.deliveryTarget.target, strategy)
        const viewState = resolveTelegramPreviewViewState(
            {
                processText: previewContext.processText,
                reasoningText: previewContext.reasoningText,
                answerText: message.body,
                toolSections: previewContext.toolSections,
            },
            {
                toolCallView: this.toolCallView,
                viewState: {
                    viewMode: "preview",
                    previewPage: storedViewState.previewPage,
                    toolsPage: storedViewState.toolsPage,
                },
            },
        )
        const nextViewState = {
            viewMode: viewState.viewMode,
            previewPage: viewState.previewPage,
            toolsPage: viewState.toolsPage,
        } satisfies TelegramPreviewViewState

        return {
            text: renderTelegramStreamMessageForView(
                {
                    processText: previewContext.processText,
                    reasoningText: previewContext.reasoningText,
                    answerText: message.body,
                    toolSections: previewContext.toolSections,
                },
                {
                    toolCallView: this.toolCallView,
                    viewState: nextViewState,
                },
            ),
            replyMarkup:
                strategy.mode === "edit"
                    ? buildTelegramStreamReplyMarkup(
                          {
                              processText: previewContext.processText,
                              reasoningText: previewContext.reasoningText,
                              answerText: message.body,
                              toolSections: previewContext.toolSections,
                          },
                          {
                              toolCallView: this.toolCallView,
                              viewState: nextViewState,
                          },
                      )
                    : null,
        }
    }

    private syncPreviewMessageState(message: BindingOutboundMessage, strategy: BindingDeferredDeliveryStrategy): void {
        if (this.toolCallView !== "toggle" || strategy.mode !== "edit") {
            return
        }

        const previewContext = message.previewContext
        const toolSections = previewContext?.toolSections ?? []
        if (previewContext == null) {
            this.store.deleteTelegramPreviewMessage(message.deliveryTarget.target, strategy.messageId)
            return
        }

        const storedViewState = this.resolveStoredViewState(message.deliveryTarget.target, strategy)
        const viewState = resolveTelegramPreviewViewState(
            {
                processText: previewContext.processText,
                reasoningText: previewContext.reasoningText,
                answerText: message.body,
                toolSections,
            },
            {
                toolCallView: this.toolCallView,
                viewState: {
                    viewMode: "preview",
                    previewPage: storedViewState.previewPage,
                    toolsPage: storedViewState.toolsPage,
                },
            },
        )
        if (viewState.toolCount === 0 && viewState.previewPageCount <= 1) {
            this.store.deleteTelegramPreviewMessage(message.deliveryTarget.target, strategy.messageId)
            return
        }

        this.store.upsertTelegramPreviewMessage({
            chatId: message.deliveryTarget.target,
            messageId: strategy.messageId,
            viewMode: viewState.viewMode,
            previewPage: viewState.previewPage,
            toolsPage: viewState.toolsPage,
            processText: previewContext.processText,
            reasoningText: previewContext.reasoningText,
            answerText: message.body,
            toolSections,
            recordedAtMs: Date.now(),
        })
    }

    private resolveStoredViewState(
        chatId: string,
        strategy: BindingDeferredDeliveryStrategy,
    ): TelegramPreviewViewState {
        if (strategy.mode !== "edit") {
            return {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            }
        }

        const preview = this.store.getTelegramPreviewMessage(chatId, strategy.messageId)
        return (
            preview ?? {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            }
        )
    }
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
