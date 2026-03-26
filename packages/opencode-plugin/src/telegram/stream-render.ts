import type { TextDeliveryPreview } from "../delivery/text"

const TELEGRAM_VISIBLE_TEXT_LIMIT = 4_096

export function renderTelegramStreamMessage(preview: TextDeliveryPreview): string {
    const processText = normalizeVisibleText(preview.processText)
    const answerText = normalizeVisibleText(preview.answerText)

    if (processText !== null && answerText !== null) {
        if (visibleLength(processText, answerText) <= TELEGRAM_VISIBLE_TEXT_LIMIT) {
            return `${renderBlockquote(processText)}\n\n${escapeHtml(answerText)}`
        }

        return escapeHtml(answerText)
    }

    if (processText !== null) {
        return renderBlockquote(processText)
    }

    if (answerText !== null) {
        return escapeHtml(answerText)
    }

    return ""
}

function renderBlockquote(text: string): string {
    return `<blockquote>${escapeHtml(text)}</blockquote>`
}

function escapeHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function visibleLength(processText: string, answerText: string): number {
    return processText.length + answerText.length + 2
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null || value.trim().length === 0) {
        return null
    }

    return value
}
