import type { BindingInboundMessage } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { TelegramChatType, TelegramUpdate } from "./types"

export type TelegramNormalizedUpdate =
    | {
          kind: "ignore"
          reason: string
      }
    | {
          kind: "message"
          chatType: TelegramChatType
          message: BindingInboundMessage
      }

type TelegramAllowlist = {
    allowedChats: ReadonlySet<string>
    allowedUsers: ReadonlySet<string>
}

type MailboxRouterLike = {
    resolve(target: BindingInboundMessage["deliveryTarget"]): string | null
}

export function buildTelegramAllowlist(config: Extract<TelegramConfig, { enabled: true }>): TelegramAllowlist {
    return {
        allowedChats: new Set(config.allowedChats),
        allowedUsers: new Set(config.allowedUsers),
    }
}

export function normalizeTelegramUpdate(
    update: TelegramUpdate,
    allowlist: TelegramAllowlist,
    mailboxRouter?: MailboxRouterLike,
): TelegramNormalizedUpdate {
    const message = update.message
    if (!message) {
        return ignored("unsupported update type")
    }

    if (typeof message.text !== "string" || message.text.trim().length === 0) {
        return ignored("message has no text body")
    }

    if (!message.from) {
        return ignored("message sender is missing")
    }

    if (message.from.is_bot === true) {
        return ignored("message sender is a bot")
    }

    const chatId = String(message.chat.id)
    const userId = String(message.from.id)
    if (!isAllowed(chatId, userId, allowlist)) {
        return ignored("message is not allowlisted")
    }

    const deliveryTarget = {
        channel: "telegram",
        target: chatId,
        topic: message.message_thread_id === undefined ? null : String(message.message_thread_id),
    } satisfies BindingInboundMessage["deliveryTarget"]

    return {
        kind: "message",
        chatType: message.chat.type,
        message: {
            mailboxKey: mailboxRouter?.resolve(deliveryTarget) ?? null,
            deliveryTarget,
            sender: `telegram:${userId}`,
            body: message.text,
        },
    }
}

function isAllowed(chatId: string, userId: string, allowlist: TelegramAllowlist): boolean {
    return allowlist.allowedChats.has(chatId) || allowlist.allowedUsers.has(userId)
}

function ignored(reason: string): TelegramNormalizedUpdate {
    return {
        kind: "ignore",
        reason,
    }
}
