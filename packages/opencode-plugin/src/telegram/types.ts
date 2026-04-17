export type TelegramApiResponse<Result> =
    | {
          ok: true
          result: Result
      }
    | {
          ok: false
          description?: string
          error_code?: number
      }

export type TelegramUpdate = {
    update_id: number
    message?: TelegramMessage
    callback_query?: TelegramCallbackQuery
}

export type TelegramMessage = {
    message_id: number
    message_thread_id?: number
    text?: string
    caption?: string
    entities?: TelegramMessageEntity[]
    caption_entities?: TelegramMessageEntity[]
    photo?: TelegramPhotoSize[]
    document?: TelegramDocument
    from?: TelegramUser
    chat: TelegramChat
    reply_to_message?: TelegramReplyMessage
}

export type TelegramMessageEntity = {
    type: string
    offset: number
    length: number
}

export type TelegramReplyMessage = {
    message_id: number
    text?: string
    caption?: string
    photo?: TelegramPhotoSize[]
    document?: TelegramDocument
    from?: TelegramUser
}

export type TelegramCallbackQuery = {
    id: string
    from: TelegramUser
    data?: string
    message?: TelegramCallbackMessage
}

export type TelegramCallbackMessage = {
    message_id: number
    message_thread_id?: number
    chat: TelegramChat
}

export type TelegramPhotoSize = {
    file_id: string
    file_unique_id?: string
    width: number
    height: number
    file_size?: number
}

export type TelegramDocument = {
    file_id: string
    file_unique_id?: string
    file_name?: string
    mime_type?: string
    file_size?: number
}

export type TelegramUser = {
    id: number
    is_bot?: boolean
    username?: string
    can_join_groups?: boolean
    can_read_all_group_messages?: boolean
    supports_inline_queries?: boolean
}

export type TelegramChat = {
    id: number
    type: string
}

export type TelegramChatType = TelegramChat["type"]

export type TelegramBotProfile = TelegramUser & {
    is_bot: true
}

export type TelegramFileRecord = {
    file_id: string
    file_unique_id?: string
    file_size?: number
    file_path?: string
}

export type TelegramInlineKeyboardButton = {
    text: string
    callback_data: string
}

export type TelegramInlineKeyboardMarkup = {
    inline_keyboard: TelegramInlineKeyboardButton[][]
}

export type TelegramSentMessage = {
    message_id: number
}

export type TelegramReactionType = {
    type: "emoji"
    emoji: string
}
