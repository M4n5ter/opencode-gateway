import type { BindingHostAck, BindingPromptResult } from "../binding"
import { formatError } from "../utils/error"

export function okAck(): BindingHostAck {
    return { errorMessage: null }
}

export function failedAck(error: unknown): BindingHostAck {
    return { errorMessage: formatErrorMessage(error) }
}

export function okPromptResult(sessionId: string, responseText: string): BindingPromptResult {
    return {
        sessionId,
        responseText,
        errorMessage: null,
    }
}

export function failedPromptResult(error: unknown): BindingPromptResult {
    return {
        sessionId: null,
        responseText: "",
        errorMessage: formatErrorMessage(error),
    }
}

function formatErrorMessage(error: unknown): string {
    return formatError(error)
}
