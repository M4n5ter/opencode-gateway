import type { TelegramToolCallView } from "../config/telegram"
import type { SqliteStore } from "../store/sqlite"
import { TelegramApiError, type TelegramCallbackClientLike } from "./client"
import type { TelegramNormalizedCallbackQuery } from "./normalize"
import { buildTelegramStreamReplyMarkup, renderTelegramStreamMessageForView } from "./stream-render"
import { parseTelegramToolVisibilityCallback } from "./tool-render"

export class TelegramToolToggleRuntime {
    constructor(
        private readonly client: TelegramCallbackClientLike | null,
        private readonly store: SqliteStore,
        private readonly toolCallView: TelegramToolCallView,
    ) {}

    async handleTelegramCallbackQuery(query: TelegramNormalizedCallbackQuery): Promise<boolean> {
        if (this.client === null || this.toolCallView !== "toggle") {
            return false
        }

        const nextVisibility = parseTelegramToolVisibilityCallback(query.data)
        if (nextVisibility === null) {
            return false
        }

        const preview = this.store.getTelegramPreviewMessage(query.deliveryTarget.target, query.messageId)
        if (preview === null) {
            await this.client.answerCallbackQuery(query.callbackQueryId, "This preview is no longer interactive.")
            return true
        }

        const renderedPreview = {
            processText: preview.processText,
            reasoningText: preview.reasoningText,
            answerText: preview.answerText,
            toolSections: preview.toolSections,
        }

        try {
            await this.client.editMessageText(
                query.deliveryTarget.target,
                query.messageId,
                renderTelegramStreamMessageForView(renderedPreview, {
                    toolCallView: "toggle",
                    toolVisibility: nextVisibility,
                }),
                {
                    parseMode: "HTML",
                    replyMarkup: buildTelegramStreamReplyMarkup(renderedPreview, {
                        toolCallView: "toggle",
                        toolVisibility: nextVisibility,
                    }),
                },
            )
        } catch (error) {
            if (!isTelegramNoopEdit(error)) {
                throw error
            }
        }

        this.store.setTelegramPreviewToolVisibility(
            query.deliveryTarget.target,
            query.messageId,
            nextVisibility,
            Date.now(),
        )
        await this.client.answerCallbackQuery(
            query.callbackQueryId,
            nextVisibility === "expanded" ? "Showing tools" : "Hiding tools",
        )
        return true
    }
}

function isTelegramNoopEdit(error: unknown): boolean {
    if (error instanceof TelegramApiError) {
        return error.message.toLowerCase().includes("message is not modified")
    }

    if (error instanceof Error) {
        return error.message.toLowerCase().includes("message is not modified")
    }

    return false
}
