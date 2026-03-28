import { readFile, writeFile } from "node:fs/promises"

import { formatError } from "../utils/error"
import type {
    TelegramApiResponse,
    TelegramBotProfile,
    TelegramChat,
    TelegramFileRecord,
    TelegramInlineKeyboardMarkup,
    TelegramReactionType,
    TelegramSentMessage,
    TelegramUpdate,
} from "./types"

type TelegramTextOptions = {
    parseMode?: "HTML" | "MarkdownV2" | "Markdown"
    replyMarkup?: TelegramInlineKeyboardMarkup | null
    disableLinkPreview?: boolean
}

export class TelegramApiError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message)
        this.name = "TelegramApiError"
    }
}

export class TelegramBotClient {
    constructor(private readonly botToken: string) {}

    async getUpdates(offset: number | null, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
        return this.call(
            "getUpdates",
            {
                offset,
                timeout: timeoutSeconds,
                allowed_updates: ["message", "callback_query"],
            },
            signal,
        )
    }

    async getMe(): Promise<TelegramBotProfile> {
        return this.call("getMe", {})
    }

    async getChat(chatId: string): Promise<TelegramChat> {
        return this.call("getChat", {
            chat_id: chatId,
        })
    }

    async getFile(fileId: string): Promise<TelegramFileRecord> {
        return this.call("getFile", {
            file_id: fileId,
        })
    }

    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        let response: Response

        try {
            response = await fetch(`https://api.telegram.org/file/bot${this.botToken}/${remotePath}`)
        } catch (error) {
            throw new TelegramApiError(`Telegram file download failed: ${formatError(error)}`, true)
        }

        if (!response.ok) {
            throw new TelegramApiError(
                `Telegram file download failed (${response.status}): ${response.statusText}`,
                isRetryableError(response.status, response.status),
            )
        }

        await writeFile(localPath, new Uint8Array(await response.arrayBuffer()))
    }

    async sendMessage(
        chatId: string,
        text: string,
        messageThreadId: string | null | undefined,
        options: TelegramTextOptions = {},
    ): Promise<TelegramSentMessage> {
        return await this.call("sendMessage", {
            chat_id: chatId,
            text,
            message_thread_id: parseMessageThreadId(messageThreadId),
            parse_mode: options.parseMode,
            reply_markup: options.replyMarkup ?? undefined,
            link_preview_options: buildTelegramLinkPreviewOptions(options),
        })
    }

    async sendInteractiveMessage(
        chatId: string,
        text: string,
        messageThreadId: string | null | undefined,
        replyMarkup: TelegramInlineKeyboardMarkup,
        options: TelegramTextOptions = {},
    ): Promise<TelegramSentMessage> {
        return await this.call("sendMessage", {
            chat_id: chatId,
            text,
            message_thread_id: parseMessageThreadId(messageThreadId),
            parse_mode: options.parseMode,
            reply_markup: replyMarkup,
            link_preview_options: buildTelegramLinkPreviewOptions(options),
        })
    }

    async sendPhoto(
        chatId: string,
        filePath: string,
        caption: string | null | undefined,
        messageThreadId: string | null | undefined,
        mimeType: string,
    ): Promise<void> {
        const form = new FormData()
        form.set("chat_id", chatId)
        setOptionalFormField(form, "caption", caption)
        setOptionalFormField(form, "message_thread_id", formatMessageThreadId(messageThreadId))
        form.set("photo", await readLocalFileBlob(filePath, mimeType), inferUploadFileName(filePath))

        await this.callMultipart("sendPhoto", form)
    }

    async sendDocument(
        chatId: string,
        filePath: string,
        caption: string | null | undefined,
        messageThreadId: string | null | undefined,
        mimeType: string,
    ): Promise<void> {
        const form = new FormData()
        form.set("chat_id", chatId)
        setOptionalFormField(form, "caption", caption)
        setOptionalFormField(form, "message_thread_id", formatMessageThreadId(messageThreadId))
        form.set("document", await readLocalFileBlob(filePath, mimeType), inferUploadFileName(filePath))

        await this.callMultipart("sendDocument", form)
    }

    async sendChatAction(chatId: string, action: string, messageThreadId: string | null | undefined): Promise<void> {
        await this.call("sendChatAction", {
            chat_id: chatId,
            action,
            message_thread_id: parseMessageThreadId(messageThreadId),
        })
    }

    async editMessageText(
        chatId: string,
        messageId: number,
        text: string,
        options: TelegramTextOptions = {},
    ): Promise<void> {
        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
            throw new Error(`invalid Telegram message id: ${messageId}`)
        }

        await this.call("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: options.parseMode,
            reply_markup: options.replyMarkup ?? undefined,
            link_preview_options: buildTelegramLinkPreviewOptions(options),
        })
    }

    async deleteMessage(chatId: string, messageId: number): Promise<void> {
        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
            throw new Error(`invalid Telegram message id: ${messageId}`)
        }

        await this.call("deleteMessage", {
            chat_id: chatId,
            message_id: messageId,
        })
    }

    async setMessageReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
            throw new Error(`invalid Telegram message id: ${messageId}`)
        }

        const reaction = normalizeReactionEmoji(emoji)
        await this.call("setMessageReaction", {
            chat_id: chatId,
            message_id: messageId,
            reaction: [
                {
                    type: "emoji",
                    emoji: reaction,
                } satisfies TelegramReactionType,
            ],
            is_big: false,
        })
    }

    async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
        await this.call("answerCallbackQuery", {
            callback_query_id: callbackQueryId,
            text,
        })
    }

    private async call<Result>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
        let response: Response

        try {
            response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify(stripUndefined(body)),
                signal,
            })
        } catch (error) {
            throw new TelegramApiError(`Telegram ${method} request failed: ${formatError(error)}`, true)
        }

        const payload = (await response.json()) as TelegramApiResponse<Result>
        if (payload.ok) {
            return payload.result
        }

        const description = payload.description ?? `HTTP ${response.status}`
        const errorCode = payload.error_code ?? response.status

        throw new TelegramApiError(
            `Telegram ${method} failed (${errorCode}): ${description}`,
            isRetryableError(errorCode, response.status),
        )
    }

    private async callMultipart<Result>(method: string, body: FormData): Promise<Result> {
        let response: Response

        try {
            response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
                method: "POST",
                body,
            })
        } catch (error) {
            throw new TelegramApiError(`Telegram ${method} request failed: ${formatError(error)}`, true)
        }

        const payload = (await response.json()) as TelegramApiResponse<Result>
        if (payload.ok) {
            return payload.result
        }

        const description = payload.description ?? `HTTP ${response.status}`
        const errorCode = payload.error_code ?? response.status

        throw new TelegramApiError(
            `Telegram ${method} failed (${errorCode}): ${description}`,
            isRetryableError(errorCode, response.status),
        )
    }
}

export type TelegramPollingClientLike = Pick<TelegramBotClient, "getUpdates">
export type TelegramSendClientLike = Pick<TelegramBotClient, "sendMessage">
export type TelegramMediaClientLike = Pick<TelegramBotClient, "getFile" | "downloadFile">
export type TelegramFileSendClientLike = Pick<TelegramBotClient, "sendPhoto" | "sendDocument">
export type TelegramChatActionClientLike = Pick<TelegramBotClient, "sendChatAction">
export type TelegramMessageEditClientLike = Pick<TelegramBotClient, "editMessageText">
export type TelegramMessageDeleteClientLike = Pick<TelegramBotClient, "deleteMessage">
export type TelegramReactionClientLike = Pick<TelegramBotClient, "setMessageReaction">

function buildTelegramLinkPreviewOptions(options: TelegramTextOptions): { is_disabled: true } | undefined {
    if (options.disableLinkPreview === false) {
        return undefined
    }

    return { is_disabled: true }
}

async function readLocalFileBlob(filePath: string, mimeType: string): Promise<Blob> {
    const bytes = await readFile(filePath)
    return new Blob([bytes], { type: mimeType })
}

function inferUploadFileName(filePath: string): string {
    const normalized = filePath.replaceAll("\\", "/")
    const segments = normalized.split("/")
    return segments.at(-1) ?? "upload"
}
export type TelegramProbeClientLike = Pick<TelegramBotClient, "getMe">
export type TelegramChatClientLike = Pick<TelegramBotClient, "getChat">
export type TelegramInteractionClientLike = Pick<TelegramBotClient, "sendInteractiveMessage" | "answerCallbackQuery">
export type TelegramCallbackClientLike = Pick<TelegramBotClient, "answerCallbackQuery" | "editMessageText">
export type TelegramOpsClientLike = TelegramSendClientLike & TelegramProbeClientLike
export type TelegramDeliveryClientLike = TelegramSendClientLike &
    TelegramMessageEditClientLike &
    TelegramChatClientLike &
    TelegramChatActionClientLike
export type TelegramRuntimeClientLike = TelegramOpsClientLike &
    TelegramDeliveryClientLike &
    TelegramMessageDeleteClientLike &
    TelegramMediaClientLike &
    TelegramFileSendClientLike

function parseMessageThreadId(value: string | null | undefined): number | undefined {
    if (value == null) {
        return undefined
    }

    const normalized = value.trim()
    if (normalized.length === 0 || normalized === "undefined") {
        return undefined
    }

    const parsed = Number.parseInt(normalized, 10)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`invalid Telegram topic id: ${value}`)
    }

    return parsed
}

function formatMessageThreadId(value: string | null | undefined): string | null {
    const parsed = parseMessageThreadId(value)
    return parsed === undefined ? null : String(parsed)
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(body).filter((entry) => entry[1] !== undefined))
}

function setOptionalFormField(form: FormData, key: string, value: string | null | undefined): void {
    if (value != null && value.trim().length > 0) {
        form.set(key, value)
    }
}

function isRetryableError(errorCode: number, httpStatus: number): boolean {
    if (errorCode === 401 || errorCode === 403 || errorCode === 404) {
        return false
    }

    if (httpStatus >= 500 || httpStatus === 429) {
        return true
    }

    return errorCode !== 400
}

function normalizeReactionEmoji(value: string): string {
    const normalized = value.trim()
    if (normalized.length === 0) {
        throw new Error("telegram reaction emoji must not be empty")
    }

    return normalized
}
