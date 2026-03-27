import type { TelegramToolCallView } from "../config/telegram"
import type { TextDeliveryPreview } from "../delivery/text"
import { escapeTelegramHtml, renderTelegramMarkdownHtml } from "./markdown"
import {
    buildTelegramToolReplyMarkup,
    renderTelegramToolSection,
    type TelegramToolVisibility,
    visibleTelegramToolSectionLength,
} from "./tool-render"
import type { TelegramInlineKeyboardMarkup } from "./types"

const TELEGRAM_VISIBLE_TEXT_LIMIT = 4_096

type TelegramStreamRenderOptions = {
    toolCallView?: TelegramToolCallView
    toolVisibility?: TelegramToolVisibility
}

export function renderTelegramFinalMessage(text: string): string {
    return renderTelegramMarkdownHtml(text)
}

export function renderTelegramStreamMessage(preview: TextDeliveryPreview): string {
    return renderTelegramStreamMessageForView(preview, {
        toolCallView: "inline",
        toolVisibility: "expanded",
    })
}

export function renderTelegramStreamMessageForView(
    preview: TextDeliveryPreview,
    options: TelegramStreamRenderOptions,
): string {
    const processText = normalizeVisibleText(preview.processText)
    const reasoningText = normalizeVisibleText(preview.reasoningText)
    const answerText = normalizeVisibleText(preview.answerText)
    const allToolSections = [...(preview.toolSections ?? [])]
    const toolSections = resolveVisibleToolSections(allToolSections, options)
    const toolSummary = resolveToolSummary(allToolSections, options)

    const answerBody = answerText === null ? null : renderTelegramFinalMessage(answerText)
    const allSections = buildSections(reasoningText, processText, toolSummary, toolSections, answerBody)
    if (
        visibleLength(reasoningText, processText, toolSummary, toolSections, answerText) <= TELEGRAM_VISIBLE_TEXT_LIMIT
    ) {
        return allSections
    }

    let nextReasoningText = reasoningText
    let nextProcessText = processText
    let nextToolSummary = toolSummary
    const nextToolSections = [...toolSections]

    if (answerText !== null && nextReasoningText !== null) {
        nextReasoningText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerBody)
        }
    }

    if (answerText !== null && nextProcessText !== null) {
        nextProcessText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerBody)
        }
    }

    while (nextToolSections.length > 0) {
        nextToolSections.shift()
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerBody)
        }
    }

    if (answerText !== null && nextToolSummary !== null) {
        nextToolSummary = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerBody)
        }
    }

    if (answerText !== null) {
        return buildSections(null, null, null, [], answerBody)
    }

    return buildSections(nextReasoningText, nextProcessText, nextToolSummary, nextToolSections, answerBody)
}

export function buildTelegramStreamReplyMarkup(
    preview: TextDeliveryPreview,
    options: TelegramStreamRenderOptions,
): TelegramInlineKeyboardMarkup | null {
    const toolCallView = options.toolCallView ?? "toggle"
    if (toolCallView !== "toggle") {
        return null
    }

    return buildTelegramToolReplyMarkup(preview.toolSections ?? [], options.toolVisibility ?? "collapsed")
}

function buildSections(
    reasoningText: string | null,
    processText: string | null,
    toolSummary: string | null,
    toolSections: TextDeliveryPreview["toolSections"],
    answerBody: string | null,
): string {
    return [
        renderReasoningBlock(reasoningText),
        renderProcessBlock(processText),
        toolSummary,
        ...(toolSections ?? []).map(renderTelegramToolSection),
        answerBody,
    ]
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

function visibleLength(
    reasoningText: string | null,
    processText: string | null,
    toolSummary: string | null,
    toolSections: TextDeliveryPreview["toolSections"],
    answerText: string | null,
): number {
    const toolLength = (toolSections ?? []).reduce(
        (length, section) => length + visibleTelegramToolSectionLength(section),
        0,
    )
    const textSegments = [reasoningText, processText, toolSummary, answerText].filter(
        (segment): segment is string => segment !== null && segment.length > 0,
    )
    const sectionCount = textSegments.length + (toolSections ?? []).length

    if (sectionCount === 0) {
        return 0
    }

    return textSegments.reduce((length, segment) => length + segment.length, 0) + toolLength + (sectionCount - 1) * 2
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null || value.trim().length === 0) {
        return null
    }

    return value
}

function resolveVisibleToolSections(
    sections: TextDeliveryPreview["toolSections"],
    options: TelegramStreamRenderOptions,
): NonNullable<TextDeliveryPreview["toolSections"]> {
    const toolCallView = options.toolCallView ?? "toggle"
    if (toolCallView === "off") {
        return []
    }

    if (toolCallView === "toggle" && (options.toolVisibility ?? "collapsed") !== "expanded") {
        return []
    }

    return [...(sections ?? [])]
}

function resolveToolSummary(
    sections: NonNullable<TextDeliveryPreview["toolSections"]>,
    options: TelegramStreamRenderOptions,
): string | null {
    if (sections.length === 0) {
        return null
    }

    const toolCallView = options.toolCallView ?? "toggle"
    if (toolCallView !== "toggle" || (options.toolVisibility ?? "collapsed") !== "collapsed") {
        return null
    }

    return `<i>${escapeTelegramHtml(formatToolSummary(sections))}</i>`
}

function formatToolSummary(sections: NonNullable<TextDeliveryPreview["toolSections"]>): string {
    const counts = new Map<string, number>()

    for (const section of sections) {
        counts.set(section.status, (counts.get(section.status) ?? 0) + 1)
    }

    const ordered = ["running", "pending", "completed", "error"]
        .map((status) => {
            const count = counts.get(status) ?? 0
            return count === 0 ? null : `${count} ${status}`
        })
        .filter((segment): segment is string => segment !== null)

    return ordered.length === 0 ? "Tools active" : `Tools: ${ordered.join(", ")}`
}
