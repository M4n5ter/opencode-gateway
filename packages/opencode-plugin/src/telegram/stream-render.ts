import type { TextDeliveryPreview } from "../delivery/text"
import { escapeTelegramHtml, renderTelegramMarkdownHtml } from "./markdown"

const TELEGRAM_VISIBLE_TEXT_LIMIT = 4_096

export function renderTelegramFinalMessage(text: string): string {
    return renderTelegramMarkdownHtml(text)
}

export function renderTelegramStreamMessage(preview: TextDeliveryPreview): string {
    const processText = normalizeVisibleText(preview.processText)
    const reasoningText = normalizeVisibleText(preview.reasoningText)
    const answerText = normalizeVisibleText(preview.answerText)

    const answerBody = answerText === null ? null : renderTelegramFinalMessage(answerText)
    const allSections = buildSections(reasoningText, processText, answerBody)
    if (visibleLength(reasoningText, processText, answerText) <= TELEGRAM_VISIBLE_TEXT_LIMIT) {
        return allSections
    }

    if (answerText !== null) {
        const withoutReasoning = buildSections(null, processText, answerBody)
        if (visibleLength(null, processText, answerText) <= TELEGRAM_VISIBLE_TEXT_LIMIT) {
            return withoutReasoning
        }

        return buildSections(null, null, answerBody)
    }

    if (processText !== null && reasoningText !== null) {
        return buildSections(null, processText, null)
    }

    return allSections
}

function buildSections(reasoningText: string | null, processText: string | null, answerBody: string | null): string {
    return [renderReasoningBlock(reasoningText), renderProcessBlock(processText), answerBody]
        .filter((section): section is string => section !== null && section.length > 0)
        .join("\n\n")
}

function renderReasoningBlock(text: string | null): string | null {
    if (text === null) {
        return null
    }

    return `<blockquote expandable><i>${escapeTelegramHtml(text)}</i></blockquote>`
}

function renderProcessBlock(text: string | null): string | null {
    if (text === null) {
        return null
    }

    return `<blockquote>${escapeTelegramHtml(text)}</blockquote>`
}

function visibleLength(reasoningText: string | null, processText: string | null, answerText: string | null): number {
    const segments = [reasoningText, processText, answerText].filter(
        (segment): segment is string => segment !== null && segment.length > 0,
    )

    if (segments.length === 0) {
        return 0
    }

    return segments.reduce((length, segment) => length + segment.length, 0) + (segments.length - 1) * 2
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null || value.trim().length === 0) {
        return null
    }

    return value
}
