import type { BindingDeliveryTarget, BindingLoggerHost } from "../binding"
import type { SqliteStore } from "../store/sqlite"
import type { TelegramDeliveryClientLike } from "../telegram/client"
import {
    readTelegramChatType,
    recordTelegramChatType,
    recordTelegramDraftFailure,
    recordTelegramDraftSuccess,
    recordTelegramStreamFallback,
} from "../telegram/state"
import { formatError } from "../utils/error"

export type DeliveryModePreference = "auto" | "oneshot" | "stream"
export type ResolvedDeliveryMode = "oneshot" | "progressive"

export class TelegramProgressiveSupport {
    constructor(
        private readonly client: TelegramDeliveryClientLike | null,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
    ) {}

    async resolveMode(
        target: BindingDeliveryTarget,
        preference: DeliveryModePreference,
    ): Promise<ResolvedDeliveryMode> {
        if (target.channel !== "telegram" || preference === "oneshot") {
            return "oneshot"
        }

        const isPrivateChat = await this.isPrivateChat(target.target)
        if (preference === "stream") {
            if (!isPrivateChat) {
                throw new Error("telegram draft stream is only supported for private chats")
            }

            return "progressive"
        }

        if (!isPrivateChat) {
            recordTelegramStreamFallback(this.store, "non_private_chat", Date.now())
            return "oneshot"
        }

        return "progressive"
    }

    async sendDraft(target: BindingDeliveryTarget, draftId: number, text: string): Promise<void> {
        if (this.client === null) {
            throw new Error("telegram transport is not configured")
        }

        try {
            await this.client.sendMessageDraft(target.target, draftId, text, target.topic)
            recordTelegramDraftSuccess(this.store, Date.now())
        } catch (error) {
            const message = formatError(error)
            recordTelegramDraftFailure(this.store, message, Date.now())
            recordTelegramStreamFallback(this.store, "draft_send_failed", Date.now())
            this.logger.log("warn", `telegram draft send failed: ${message}`)
            throw error
        }
    }

    startTyping(target: BindingDeliveryTarget): void {
        if (this.client === null) {
            return
        }

        void this.client.sendChatAction(target.target, "typing", target.topic).catch(() => {
            // Typing hints are best-effort only.
        })
    }

    private async isPrivateChat(chatId: string): Promise<boolean> {
        const cachedChatType = readTelegramChatType(this.store, chatId)
        if (cachedChatType !== null) {
            return cachedChatType === "private"
        }

        if (this.client === null) {
            return false
        }

        try {
            const chat = await this.client.getChat(chatId)
            recordTelegramChatType(this.store, chatId, chat.type, Date.now())
            return chat.type === "private"
        } catch (error) {
            this.logger.log("warn", `failed to resolve Telegram chat type for ${chatId}: ${formatError(error)}`)
            return false
        }
    }
}

export function createDraftId(): number {
    const draftId = crypto.getRandomValues(new Uint32Array(1))[0]
    return draftId === 0 ? 1 : draftId
}
