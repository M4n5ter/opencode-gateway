import type { BindingInboundMessage } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type {
    TelegramCallbackQuery,
    TelegramChatType,
    TelegramDocument,
    TelegramMessage,
    TelegramMessageEntity,
    TelegramPhotoSize,
    TelegramReplyMessage,
    TelegramUpdate,
} from "./types"

const REPLY_CONTEXT_MAX_TEXT_CHARS = 1_500

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
    replyContext: BindingInboundMessage["replyContext"]
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
    allowedBotUsers: ReadonlySet<string>
}

export type TelegramBotIdentity = {
    id: string
    username: string | null
}

type MailboxRouterLike = {
    resolve(target: BindingInboundMessage["deliveryTarget"]): string | null
}

export function buildTelegramAllowlist(config: Extract<TelegramConfig, { enabled: true }>): TelegramAllowlist {
    return {
        allowedChats: new Set(config.allowedChats),
        allowedUsers: new Set(config.allowedUsers),
        allowedBotUsers: new Set(config.allowedBotUsers),
    }
}

export function normalizeTelegramUpdate(
    update: TelegramUpdate,
    allowlist: TelegramAllowlist,
    botIdentity: TelegramBotIdentity,
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

    const chatId = String(message.chat.id)
    const userId = String(message.from.id)
    const senderIsBot = message.from.is_bot === true
    const chatType = message.chat.type

    if (chatType === "group" || chatType === "supergroup") {
        if (!isAllowedGroup(chatId, userId, senderIsBot, allowlist)) {
            return ignored("message is not allowlisted")
        }

        if (!targetsCurrentBot(message, botIdentity)) {
            return ignored("group message does not mention bot")
        }
    } else if (!isAllowedPrivate(chatId, userId, allowlist)) {
        return ignored("message is not allowlisted")
    }

    const deliveryTarget = {
        channel: "telegram",
        target: chatId,
        topic: message.message_thread_id === undefined ? null : String(message.message_thread_id),
    } satisfies BindingInboundMessage["deliveryTarget"]

    const attachments = extractAttachments(message.photo, message.document)
    const text = normalizeOptionalText(message.text ?? message.caption ?? null)
    const replyContext = normalizeReplyContext(message.reply_to_message)
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
            replyContext,
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
    const chatType = message.chat.type
    const senderIsBot = callbackQuery.from.is_bot === true
    const allowed =
        chatType === "group" || chatType === "supergroup"
            ? isAllowedGroup(chatId, userId, senderIsBot, allowlist)
            : isAllowedPrivate(chatId, userId, allowlist)

    if (!allowed) {
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

function normalizeReplyContext(reply: TelegramReplyMessage | undefined): BindingInboundMessage["replyContext"] {
    if (!reply) {
        return null
    }

    const normalizedText = normalizeReplyText(reply.text ?? reply.caption ?? null)
    return {
        messageId: String(reply.message_id),
        sender: reply.from ? `telegram:${reply.from.id}` : null,
        senderIsBot: reply.from?.is_bot ?? null,
        text: normalizedText.text,
        textTruncated: normalizedText.truncated,
        attachments: extractReplyAttachments(reply.photo, reply.document),
    }
}

function extractReplyAttachments(
    photo: TelegramPhotoSize[] | undefined,
    document: TelegramDocument | undefined,
): NonNullable<BindingInboundMessage["replyContext"]>["attachments"] {
    if (Array.isArray(photo) && photo.length > 0) {
        return [
            {
                kind: "image",
                mimeType: null,
                fileName: null,
            },
        ]
    }

    if (document?.mime_type?.startsWith("image/") === true) {
        return [
            {
                kind: "image",
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

function isAllowedPrivate(chatId: string, userId: string, allowlist: TelegramAllowlist): boolean {
    return isAllowed(chatId, userId, allowlist)
}

function isAllowedGroup(chatId: string, userId: string, senderIsBot: boolean, allowlist: TelegramAllowlist): boolean {
    if (!allowlist.allowedChats.has(chatId)) {
        return false
    }

    return senderIsBot ? allowlist.allowedBotUsers.has(userId) : allowlist.allowedUsers.has(userId)
}

function mentionsCurrentBot(message: TelegramMessage, botUsername: string | null): boolean {
    if (botUsername === null) {
        return false
    }

    const expectedMention = `@${botUsername}`

    return (
        hasMentionEntity(message.text, message.entities, expectedMention) ||
        hasMentionEntity(message.caption, message.caption_entities, expectedMention)
    )
}

function hasMentionEntity(
    text: string | undefined,
    entities: TelegramMessageEntity[] | undefined,
    expectedMention: string,
): boolean {
    if (text === undefined || entities === undefined) {
        return false
    }

    for (const entity of entities) {
        if (entity.type !== "mention") {
            continue
        }

        const mention = text.slice(entity.offset, entity.offset + entity.length)
        if (mention === expectedMention) {
            return true
        }
    }

    return false
}

function repliesToCurrentBot(reply: TelegramReplyMessage | undefined, botIdentity: TelegramBotIdentity): boolean {
    if (!reply?.from) {
        return false
    }

    if (botIdentity.id.length > 0 && String(reply.from.id) === botIdentity.id) {
        return true
    }

    if (botIdentity.username === null) {
        return false
    }

    return reply.from.username === botIdentity.username
}

function targetsCurrentBot(message: TelegramMessage, botIdentity: TelegramBotIdentity): boolean {
    return (
        mentionsCurrentBot(message, botIdentity.username) || repliesToCurrentBot(message.reply_to_message, botIdentity)
    )
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

function normalizeReplyText(value: string | null): { text: string | null; truncated: boolean } {
    const normalized = normalizeOptionalText(value)
    if (normalized === null) {
        return {
            text: null,
            truncated: false,
        }
    }

    if (normalized.length <= REPLY_CONTEXT_MAX_TEXT_CHARS) {
        return {
            text: normalized,
            truncated: false,
        }
    }

    return {
        text: normalized.slice(0, REPLY_CONTEXT_MAX_TEXT_CHARS).trimEnd(),
        truncated: true,
    }
}
