import type { BindingInboundMessage } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type {
    TelegramCallbackQuery,
    TelegramChatType,
    TelegramDocument,
    TelegramPhotoSize,
    TelegramUpdate,
} from "./types"

export type TelegramPendingAttachment = {
    kind: "image"
    fileId: string
    fileUniqueId: string | null
    mimeType: string | null
    fileName: string | null
}

export type TelegramNormalizedInboundMessage = {
    mailboxKey: string | null
    deliveryTarget: BindingInboundMessage["deliveryTarget"]
    sender: string
    text: string | null
    attachments: TelegramPendingAttachment[]
}

export type TelegramNormalizedUpdate =
    | {
          kind: "ignore"
          reason: string
      }
    | {
          kind: "message"
          chatType: TelegramChatType
          message: TelegramNormalizedInboundMessage
      }
    | {
          kind: "callbackQuery"
          callbackQuery: TelegramNormalizedCallbackQuery
      }

export type TelegramNormalizedCallbackQuery = {
    callbackQueryId: string
    sender: string
    deliveryTarget: BindingInboundMessage["deliveryTarget"]
    messageId: number
    data: string | null
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
    if (update.callback_query) {
        return normalizeTelegramCallbackQuery(update.callback_query, allowlist)
    }

    const message = update.message
    if (!message) {
        return ignored("unsupported update type")
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

    const attachments = extractAttachments(message.photo, message.document)
    const text = normalizeOptionalText(message.text ?? message.caption ?? null)
    if (text === null && attachments.length === 0) {
        return ignored("message has no supported content")
    }

    return {
        kind: "message",
        chatType: message.chat.type,
        message: {
            mailboxKey: mailboxRouter?.resolve(deliveryTarget) ?? null,
            deliveryTarget,
            sender: `telegram:${userId}`,
            text,
            attachments,
        },
    }
}

function normalizeTelegramCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    allowlist: TelegramAllowlist,
): TelegramNormalizedUpdate {
    const message = callbackQuery.message
    if (!message) {
        return ignored("callback query message is missing")
    }

    const chatId = String(message.chat.id)
    const userId = String(callbackQuery.from.id)
    if (!isAllowed(chatId, userId, allowlist)) {
        return ignored("callback query is not allowlisted")
    }

    return {
        kind: "callbackQuery",
        callbackQuery: {
            callbackQueryId: callbackQuery.id,
            sender: `telegram:${userId}`,
            deliveryTarget: {
                channel: "telegram",
                target: chatId,
                topic: message.message_thread_id === undefined ? null : String(message.message_thread_id),
            },
            messageId: message.message_id,
            data: normalizeOptionalText(callbackQuery.data ?? null),
        },
    }
}

function extractAttachments(
    photo: TelegramPhotoSize[] | undefined,
    document: TelegramDocument | undefined,
): TelegramPendingAttachment[] {
    const photoAttachment = selectLargestPhoto(photo)
    if (photoAttachment !== null) {
        return [photoAttachment]
    }

    if (document?.mime_type?.startsWith("image/") === true) {
        return [
            {
                kind: "image",
                fileId: document.file_id,
                fileUniqueId: document.file_unique_id ?? null,
                mimeType: document.mime_type,
                fileName: normalizeOptionalText(document.file_name ?? null),
            },
        ]
    }

    return []
}

function selectLargestPhoto(photo: TelegramPhotoSize[] | undefined): TelegramPendingAttachment | null {
    if (!Array.isArray(photo) || photo.length === 0) {
        return null
    }

    const largest = photo[photo.length - 1]
    return {
        kind: "image",
        fileId: largest.file_id,
        fileUniqueId: largest.file_unique_id ?? null,
        mimeType: null,
        fileName: null,
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

function normalizeOptionalText(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}
