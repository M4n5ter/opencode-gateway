import { escapeTelegramHtml } from "./markdown"
import type { TelegramInlineKeyboardMarkup } from "./types"

const TOOL_SECTION_TEXT_LIMIT = 1_500
const TOOL_TOGGLE_SHOW_DATA = "tv:show"
const TOOL_TOGGLE_HIDE_DATA = "tv:hide"

export type TelegramToolSection = {
    callId: string
    toolName: string
    status: "pending" | "running" | "completed" | "error"
    title: string | null
    inputText: string | null
    outputText: string | null
    errorText: string | null
}

export type TelegramToolVisibility = "collapsed" | "expanded"

export function renderTelegramToolSection(section: TelegramToolSection): string {
    const title = section.title === null ? section.toolName : section.title
    const details = [
        renderToolField("Input", section.inputText),
        renderToolField("Output", section.outputText),
        renderToolField("Error", section.errorText),
    ]
        .filter((value): value is string => value !== null)
        .join("\n\n")

    const header = `<b>${escapeTelegramHtml(title)}</b> <i>${escapeTelegramHtml(section.status)}</i>`
    if (details.length === 0) {
        return header
    }

    return `${header}\n<blockquote expandable>${details}</blockquote>`
}

export function buildTelegramToolReplyMarkup(
    sections: TelegramToolSection[],
    visibility: TelegramToolVisibility,
): TelegramInlineKeyboardMarkup | null {
    if (sections.length === 0) {
        return null
    }

    return {
        inline_keyboard: [
            [
                {
                    text: visibility === "expanded" ? "Hide Tools" : `Show Tools (${sections.length})`,
                    callback_data: visibility === "expanded" ? TOOL_TOGGLE_HIDE_DATA : TOOL_TOGGLE_SHOW_DATA,
                },
            ],
        ],
    }
}

export function parseTelegramToolVisibilityCallback(data: string | null): TelegramToolVisibility | null {
    switch (data) {
        case TOOL_TOGGLE_SHOW_DATA:
            return "expanded"
        case TOOL_TOGGLE_HIDE_DATA:
            return "collapsed"
        default:
            return null
    }
}

export function visibleTelegramToolSectionLength(section: TelegramToolSection): number {
    return [section.title ?? section.toolName, section.status, section.inputText, section.outputText, section.errorText]
        .filter((value): value is string => value !== null && value.length > 0)
        .reduce((length, value) => length + value.length, 0)
}

function renderToolField(label: string, value: string | null): string | null {
    if (value === null || value.trim().length === 0) {
        return null
    }

    return `${escapeTelegramHtml(label)}\n${escapeTelegramHtml(truncateToolText(value))}`
}

function truncateToolText(value: string): string {
    const trimmed = value.trim()
    if (trimmed.length <= TOOL_SECTION_TEXT_LIMIT) {
        return trimmed
    }

    return `${trimmed.slice(0, TOOL_SECTION_TEXT_LIMIT - 1)}…`
}
