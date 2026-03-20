type ErrorLike = {
    name?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    cause?: unknown
    data?: unknown
}

export function formatError(error: unknown): string {
    if (error instanceof Error) {
        const errorLike = error as ErrorLike
        const nestedMessage = extractNestedDataMessage(errorLike.data)
        if (nestedMessage !== null) {
            return nestedMessage
        }

        return error.message
    }

    if (typeof error === "string") {
        return error
    }

    if (typeof error === "object" && error !== null) {
        const errorLike = error as ErrorLike
        const nestedMessage = extractNestedDataMessage(errorLike.data)
        if (nestedMessage !== null) {
            return nestedMessage
        }

        if (typeof errorLike.message === "string" && errorLike.message.length > 0) {
            const detail = compactObject({
                name: errorLike.name,
                code: errorLike.code,
                status: errorLike.status,
                cause: errorLike.cause,
            })

            return detail === null ? errorLike.message : `${errorLike.message} (${detail})`
        }

        const serialized = safeJsonStringify(error)
        if (serialized !== null) {
            return serialized
        }
    }

    return String(error)
}

function extractNestedDataMessage(value: unknown): string | null {
    if (typeof value !== "object" || value === null) {
        return null
    }

    const message = (value as { message?: unknown }).message
    return typeof message === "string" && message.length > 0 ? message : null
}

function compactObject(value: Record<string, unknown>): string | null {
    const entries = Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null)
    if (entries.length === 0) {
        return null
    }

    const serialized = safeJsonStringify(Object.fromEntries(entries))
    return serialized ?? entries.map(([key, fieldValue]) => `${key}=${String(fieldValue)}`).join(", ")
}

function safeJsonStringify(value: unknown): string | null {
    try {
        return JSON.stringify(value)
    } catch {
        return null
    }
}
