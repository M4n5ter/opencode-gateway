import type { TelegramApiResponse, TelegramUpdate } from "./types"

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

    async getUpdates(offset: number | null, timeoutSeconds: number): Promise<TelegramUpdate[]> {
        return this.call("getUpdates", {
            offset,
            timeout: timeoutSeconds,
            allowed_updates: ["message"],
        })
    }

    async sendMessage(chatId: string, text: string, messageThreadId: string | null): Promise<void> {
        await this.call("sendMessage", {
            chat_id: chatId,
            text,
            message_thread_id: parseMessageThreadId(messageThreadId),
        })
    }

    private async call<Result>(method: string, body: Record<string, unknown>): Promise<Result> {
        let response: Response

        try {
            response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify(stripUndefined(body)),
            })
        } catch (error) {
            throw new TelegramApiError(`Telegram ${method} request failed: ${String(error)}`, true)
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

function parseMessageThreadId(value: string | null): number | undefined {
    if (value === null) {
        return undefined
    }

    const parsed = Number.parseInt(value, 10)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`invalid Telegram topic id: ${value}`)
    }

    return parsed
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(body).filter((entry) => entry[1] !== undefined))
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
