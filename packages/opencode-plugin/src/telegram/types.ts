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
}

export type TelegramMessage = {
    message_id: number
    message_thread_id?: number
    text?: string
    from?: TelegramUser
    chat: TelegramChat
}

export type TelegramUser = {
    id: number
    is_bot?: boolean
}

export type TelegramChat = {
    id: number
    type: string
}
