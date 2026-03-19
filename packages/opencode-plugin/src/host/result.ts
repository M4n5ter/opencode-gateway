import type { BindingHostAck, BindingPromptResult, BindingSessionBinding } from "../binding"

export function okAck(): BindingHostAck {
    return { errorMessage: null }
}

export function failedAck(error: unknown): BindingHostAck {
    return { errorMessage: formatErrorMessage(error) }
}

export function okSessionBinding(sessionId: string | null): BindingSessionBinding {
    return {
        sessionId,
        errorMessage: null,
    }
}

export function failedSessionBinding(error: unknown): BindingSessionBinding {
    return {
        sessionId: null,
        errorMessage: formatErrorMessage(error),
    }
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
    return error instanceof Error ? error.message : String(error)
}
