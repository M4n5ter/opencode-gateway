import type { TelegramToolCallView } from "../config/telegram"
import type { SqliteStore, TelegramPreviewMessageRecord } from "../store/sqlite"
import { TelegramApiError, type TelegramCallbackClientLike } from "./client"
import type { TelegramNormalizedCallbackQuery } from "./normalize"
import {
    buildTelegramStreamReplyMarkup,
    parseTelegramToolToggleCallback,
    renderTelegramStreamMessageForView,
    resolveTelegramPreviewViewState,
    type TelegramPreviewViewState,
    type TelegramToolToggleAction,
} from "./stream-render"

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

        const action = parseTelegramToolToggleCallback(query.data)
        if (action === null) {
            return false
        }

        if (action === "noop") {
            await this.client.answerCallbackQuery(query.callbackQueryId)
            return true
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
        const nextViewState = resolveNextViewState(preview, action)
        const resolvedViewState = resolveTelegramPreviewViewState(renderedPreview, {
            toolCallView: "toggle",
            viewState: nextViewState,
        })
        const persistedViewState = {
            viewMode: resolvedViewState.viewMode,
            toolsPage: resolvedViewState.toolsPage,
        } satisfies TelegramPreviewViewState

        try {
            await this.client.editMessageText(
                query.deliveryTarget.target,
                query.messageId,
                renderTelegramStreamMessageForView(renderedPreview, {
                    toolCallView: "toggle",
                    viewState: persistedViewState,
                }),
                {
                    parseMode: "HTML",
                    replyMarkup: buildTelegramStreamReplyMarkup(renderedPreview, {
                        toolCallView: "toggle",
                        viewState: persistedViewState,
                    }),
                },
            )
        } catch (error) {
            if (!isTelegramNoopEdit(error)) {
                throw error
            }
        }

        this.store.setTelegramPreviewViewState(
            query.deliveryTarget.target,
            query.messageId,
            persistedViewState.viewMode,
            persistedViewState.toolsPage,
            Date.now(),
        )
        await this.client.answerCallbackQuery(
            query.callbackQueryId,
            formatToggleAck(action, resolvedViewState.toolsPage, resolvedViewState.toolsPageCount),
        )
        return true
    }
}

function resolveNextViewState(
    preview: Pick<TelegramPreviewMessageRecord, "viewMode" | "toolsPage">,
    action: TelegramToolToggleAction,
): TelegramPreviewViewState {
    switch (action) {
        case "preview":
            return {
                viewMode: "preview",
                toolsPage: preview.toolsPage,
            }
        case "tools":
            return {
                viewMode: "tools",
                toolsPage: preview.toolsPage,
            }
        case "newer":
            return {
                viewMode: "tools",
                toolsPage: Math.max(0, preview.toolsPage - 1),
            }
        case "older":
            return {
                viewMode: "tools",
                toolsPage: preview.toolsPage + 1,
            }
        case "noop":
            return {
                viewMode: preview.viewMode,
                toolsPage: preview.toolsPage,
            }
    }
}

function formatToggleAck(
    action: TelegramToolToggleAction,
    toolsPage: number,
    toolsPageCount: number,
): string | undefined {
    switch (action) {
        case "preview":
            return "Showing preview"
        case "tools":
            return "Showing tools"
        case "newer":
        case "older":
            return `Tools ${toolsPage + 1}/${Math.max(toolsPageCount, 1)}`
        case "noop":
            return undefined
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
