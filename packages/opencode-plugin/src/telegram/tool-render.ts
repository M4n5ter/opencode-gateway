import { escapeTelegramHtml } from "./markdown"

const TOOL_SECTION_TEXT_LIMIT = 1_000

export type TelegramToolSection = {
    callId: string
    toolName: string
    status: "pending" | "running" | "completed" | "error"
    title: string | null
    inputText: string | null
    outputText: string | null
    errorText: string | null
}

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
