import type { TelegramToolCallView } from "../config/telegram"
import type { TextDeliveryPreview } from "../delivery/text"
import {
    escapeTelegramHtml,
    extractVisibleTelegramHtmlText,
    renderTelegramMarkdownBlocks,
    renderTelegramMarkdownHtml,
    visibleTelegramHtmlLength,
} from "./markdown"
import { renderTelegramToolSection, type TelegramToolSection, visibleTelegramToolSectionLength } from "./tool-render"
import type { TelegramInlineKeyboardButton, TelegramInlineKeyboardMarkup } from "./types"

const TELEGRAM_VISIBLE_TEXT_LIMIT = 4_096
const PREVIEW_BLOCK_TEXT_CHUNK_LIMIT = TELEGRAM_VISIBLE_TEXT_LIMIT - 128
const TOOL_VIEW_PREVIEW_DATA = "tv:preview"
const TOOL_VIEW_TOOLS_DATA = "tv:tools"
const TOOL_VIEW_NEWER_DATA = "tv:newer"
const TOOL_VIEW_OLDER_DATA = "tv:older"
const PREVIEW_VIEW_PREVIOUS_DATA = "tv:preview_prev"
const PREVIEW_VIEW_NEXT_DATA = "tv:preview_next"
const TOOL_VIEW_NOOP_DATA = "tv:noop"

export type TelegramPreviewViewMode = "preview" | "tools"

export type TelegramPreviewViewState = {
    viewMode: TelegramPreviewViewMode
    previewPage: number
    toolsPage: number
}

export type TelegramToolToggleAction =
    | "preview"
    | "tools"
    | "newer"
    | "older"
    | "preview_previous"
    | "preview_next"
    | "noop"

type TelegramStreamRenderOptions = {
    toolCallView?: TelegramToolCallView
    viewState?: Partial<TelegramPreviewViewState> | null
}

type TelegramResolvedPreviewViewState = TelegramPreviewViewState & {
    toolCount: number
    toolsPageCount: number
    visibleToolSections: TelegramToolSection[]
    previewPageCount: number
    previewBody: string
}

type RenderedPreviewBlock = {
    html: string
    visibleText: string
    visibleLength: number
}

type RenderedPreviewPage = {
    html: string
    visibleText: string
}

export function renderTelegramFinalMessage(text: string): string {
    return renderTelegramMarkdownHtml(text)
}

export function renderTelegramStreamMessage(preview: TextDeliveryPreview): string {
    return renderTelegramStreamMessageForView(preview, {
        toolCallView: "inline",
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
    const toolCallView = options.toolCallView ?? "toggle"

    if (toolCallView === "off") {
        return renderPreviewOnlyMessage({
            reasoningText,
            processText,
            answerText,
            fallbackToolSummary: null,
        })
    }

    if (toolCallView === "inline") {
        return renderInlineMessage({
            reasoningText,
            processText,
            answerText,
            toolSections: allToolSections,
        })
    }

    const resolvedView = resolveTelegramPreviewViewState(preview, options)
    if (resolvedView.viewMode === "tools") {
        return buildSections(null, null, null, resolvedView.visibleToolSections, null)
    }

    return resolvedView.previewBody
}

export function buildTelegramStreamReplyMarkup(
    preview: TextDeliveryPreview,
    options: TelegramStreamRenderOptions,
): TelegramInlineKeyboardMarkup | null {
    const toolCallView = options.toolCallView ?? "toggle"
    if (toolCallView !== "toggle") {
        return null
    }

    const resolvedView = resolveTelegramPreviewViewState(preview, options)
    const rows: TelegramInlineKeyboardButton[][] = []

    if (resolvedView.toolCount > 0) {
        rows.push([
            {
                text: resolvedView.viewMode === "preview" ? "• Preview" : "Preview",
                callback_data: TOOL_VIEW_PREVIEW_DATA,
            },
            {
                text:
                    resolvedView.viewMode === "tools"
                        ? `• Tools (${resolvedView.toolCount})`
                        : `Tools (${resolvedView.toolCount})`,
                callback_data: TOOL_VIEW_TOOLS_DATA,
            },
        ])
    }

    if (resolvedView.viewMode === "preview" && resolvedView.previewPageCount > 1) {
        rows.push(
            buildPaginationRow({
                page: resolvedView.previewPage,
                pageCount: resolvedView.previewPageCount,
                previousLabel: "Prev",
                previousData: PREVIEW_VIEW_PREVIOUS_DATA,
                nextLabel: "Next",
                nextData: PREVIEW_VIEW_NEXT_DATA,
            }),
        )
    }

    if (resolvedView.viewMode === "tools" && resolvedView.toolsPageCount > 1) {
        rows.push(
            buildPaginationRow({
                page: resolvedView.toolsPage,
                pageCount: resolvedView.toolsPageCount,
                previousLabel: "Newer",
                previousData: TOOL_VIEW_NEWER_DATA,
                nextLabel: "Older",
                nextData: TOOL_VIEW_OLDER_DATA,
            }),
        )
    }

    return rows.length === 0
        ? null
        : {
              inline_keyboard: rows,
          }
}

export function parseTelegramToolToggleCallback(data: string | null): TelegramToolToggleAction | null {
    switch (data) {
        case TOOL_VIEW_PREVIEW_DATA:
            return "preview"
        case TOOL_VIEW_TOOLS_DATA:
            return "tools"
        case TOOL_VIEW_NEWER_DATA:
            return "newer"
        case TOOL_VIEW_OLDER_DATA:
            return "older"
        case PREVIEW_VIEW_PREVIOUS_DATA:
            return "preview_previous"
        case PREVIEW_VIEW_NEXT_DATA:
            return "preview_next"
        case TOOL_VIEW_NOOP_DATA:
            return "noop"
        default:
            return null
    }
}

export function resolveTelegramPreviewViewState(
    preview: TextDeliveryPreview,
    options: TelegramStreamRenderOptions,
): TelegramResolvedPreviewViewState {
    const toolCallView = options.toolCallView ?? "toggle"
    const processText = normalizeVisibleText(preview.processText)
    const reasoningText = normalizeVisibleText(preview.reasoningText)
    const answerText = normalizeVisibleText(preview.answerText)
    const allToolSections = [...(preview.toolSections ?? [])]
    const previewPages = paginatePreviewBodyPages({
        reasoningText,
        processText,
        answerText,
        fallbackToolSummary:
            reasoningText === null && processText === null && answerText === null && allToolSections.length > 0
                ? `<i>${escapeTelegramHtml(formatToolSummary(allToolSections))}</i>`
                : null,
    })
    const maxPreviewPageIndex = Math.max(0, previewPages.length - 1)
    const requestedPreviewPage = options.viewState?.previewPage ?? 0
    const previewPage = clamp(Math.trunc(requestedPreviewPage), 0, maxPreviewPageIndex)

    if (toolCallView !== "toggle") {
        return {
            viewMode: "preview",
            previewPage,
            previewPageCount: previewPages.length,
            previewBody: previewPages[previewPage]?.html ?? "",
            toolsPage: 0,
            toolCount: allToolSections.length,
            toolsPageCount: allToolSections.length === 0 ? 0 : 1,
            visibleToolSections: [],
        }
    }

    const pages = paginateToolSections(allToolSections)
    const maxToolsPageIndex = Math.max(0, pages.length - 1)
    const requestedToolsPage = options.viewState?.toolsPage ?? 0
    const toolsPage = clamp(Math.trunc(requestedToolsPage), 0, maxToolsPageIndex)
    const requestedViewMode = options.viewState?.viewMode ?? "preview"
    const viewMode: TelegramPreviewViewMode =
        allToolSections.length > 0 && requestedViewMode === "tools" ? "tools" : "preview"

    return {
        viewMode,
        previewPage,
        previewPageCount: previewPages.length,
        previewBody: previewPages[previewPage]?.html ?? "",
        toolsPage,
        toolCount: allToolSections.length,
        toolsPageCount: pages.length,
        visibleToolSections: viewMode === "tools" ? (pages[toolsPage] ?? []) : [],
    }
}

function renderPreviewOnlyMessage(input: {
    reasoningText: string | null
    processText: string | null
    answerText: string | null
    fallbackToolSummary: string | null
}): string {
    let nextReasoningText = input.reasoningText
    let nextProcessText = input.processText
    let nextToolSummary = input.fallbackToolSummary
    const answerBody = input.answerText === null ? null : renderTelegramFinalMessage(input.answerText)

    if (
        visibleLength(nextReasoningText, nextProcessText, nextToolSummary, [], input.answerText) <=
        TELEGRAM_VISIBLE_TEXT_LIMIT
    ) {
        return buildSections(nextReasoningText, nextProcessText, nextToolSummary, [], answerBody)
    }

    if (input.answerText !== null && nextReasoningText !== null) {
        nextReasoningText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, [], input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, [], answerBody)
        }
    }

    if (input.answerText !== null && nextProcessText !== null) {
        nextProcessText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, [], input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, [], answerBody)
        }
    }

    if (input.answerText !== null && nextToolSummary !== null) {
        nextToolSummary = null
        if (
            visibleLength(nextReasoningText, nextProcessText, nextToolSummary, [], input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, nextToolSummary, [], answerBody)
        }
    }

    if (input.answerText !== null) {
        return buildSections(null, null, null, [], answerBody)
    }

    return buildSections(nextReasoningText, nextProcessText, nextToolSummary, [], answerBody)
}

function renderInlineMessage(input: {
    reasoningText: string | null
    processText: string | null
    answerText: string | null
    toolSections: TelegramToolSection[]
}): string {
    const answerBody = input.answerText === null ? null : renderTelegramFinalMessage(input.answerText)
    if (
        visibleLength(input.reasoningText, input.processText, null, input.toolSections, input.answerText) <=
        TELEGRAM_VISIBLE_TEXT_LIMIT
    ) {
        return buildSections(input.reasoningText, input.processText, null, input.toolSections, answerBody)
    }

    let nextReasoningText = input.reasoningText
    let nextProcessText = input.processText
    const nextToolSections = [...input.toolSections]

    if (input.answerText !== null && nextReasoningText !== null) {
        nextReasoningText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, null, nextToolSections, input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, null, nextToolSections, answerBody)
        }
    }

    if (input.answerText !== null && nextProcessText !== null) {
        nextProcessText = null
        if (
            visibleLength(nextReasoningText, nextProcessText, null, nextToolSections, input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, null, nextToolSections, answerBody)
        }
    }

    while (nextToolSections.length > 0) {
        nextToolSections.shift()
        if (
            visibleLength(nextReasoningText, nextProcessText, null, nextToolSections, input.answerText) <=
            TELEGRAM_VISIBLE_TEXT_LIMIT
        ) {
            return buildSections(nextReasoningText, nextProcessText, null, nextToolSections, answerBody)
        }
    }

    if (input.answerText !== null) {
        return buildSections(null, null, null, [], answerBody)
    }

    return buildSections(nextReasoningText, nextProcessText, null, nextToolSections, answerBody)
}

function buildSections(
    reasoningText: string | null,
    processText: string | null,
    toolSummary: string | null,
    toolSections: TelegramToolSection[],
    answerBody: string | null,
): string {
    return [
        renderReasoningBlock(reasoningText),
        renderProcessBlock(processText),
        toolSummary,
        ...toolSections.map(renderTelegramToolSection),
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
    toolSections: TelegramToolSection[],
    answerText: string | null,
): number {
    const toolLength = toolSections.reduce((length, section) => length + visibleTelegramToolSectionLength(section), 0)
    const textSegments = [reasoningText, processText, toolSummary, answerText].filter(
        (segment): segment is string => segment !== null && segment.length > 0,
    )
    const sectionCount = textSegments.length + toolSections.length

    if (sectionCount === 0) {
        return 0
    }

    return textSegments.reduce((length, segment) => length + segment.length, 0) + toolLength + (sectionCount - 1) * 2
}

function paginatePreviewBodyPages(input: {
    reasoningText: string | null
    processText: string | null
    answerText: string | null
    fallbackToolSummary: string | null
}): RenderedPreviewPage[] {
    const blocks = [
        ...renderTextPreviewBlocks(input.reasoningText, renderReasoningBlock),
        ...renderTextPreviewBlocks(input.processText, renderProcessBlock),
        ...(input.fallbackToolSummary === null
            ? []
            : [
                  {
                      html: input.fallbackToolSummary,
                      visibleText: extractVisibleTelegramHtmlText(input.fallbackToolSummary),
                      visibleLength: visibleTelegramHtmlLength(input.fallbackToolSummary),
                  } satisfies RenderedPreviewBlock,
              ]),
        ...renderAnswerPreviewBlocks(input.answerText),
    ]

    if (blocks.length === 0) {
        return [{ html: "", visibleText: "" }]
    }

    return paginateRenderedPreviewBlocks(blocks)
}

function renderTextPreviewBlocks(
    text: string | null,
    renderBlock: (text: string) => string | null,
): RenderedPreviewBlock[] {
    if (text === null) {
        return []
    }

    return chunkVisibleText(text).flatMap((chunk) => {
        const html = renderBlock(chunk)
        return html === null
            ? []
            : [
                  {
                      html,
                      visibleText: chunk,
                      visibleLength: chunk.length,
                  },
              ]
    })
}

function renderAnswerPreviewBlocks(answerText: string | null): RenderedPreviewBlock[] {
    if (answerText === null) {
        return []
    }

    return renderTelegramMarkdownBlocks(answerText).flatMap(splitOversizedPreviewBlock)
}

function splitOversizedPreviewBlock(block: RenderedPreviewBlock): RenderedPreviewBlock[] {
    if (block.visibleLength <= TELEGRAM_VISIBLE_TEXT_LIMIT) {
        return [block]
    }

    return chunkVisibleText(block.visibleText).map((chunk) => ({
        html: escapeTelegramHtml(chunk),
        visibleText: chunk,
        visibleLength: chunk.length,
    }))
}

function paginateRenderedPreviewBlocks(blocks: RenderedPreviewBlock[]): RenderedPreviewPage[] {
    const pages: RenderedPreviewPage[] = []
    let currentPage: RenderedPreviewBlock[] = []
    let currentLength = 0

    for (const block of blocks) {
        const nextLength = currentPage.length === 0 ? block.visibleLength : currentLength + 2 + block.visibleLength
        if (currentPage.length > 0 && nextLength > TELEGRAM_VISIBLE_TEXT_LIMIT) {
            pages.push(buildRenderedPreviewPage(currentPage))
            currentPage = [block]
            currentLength = block.visibleLength
            continue
        }

        currentPage.push(block)
        currentLength = nextLength
    }

    if (currentPage.length > 0) {
        pages.push(buildRenderedPreviewPage(currentPage))
    }

    return pages.length === 0 ? [{ html: "", visibleText: "" }] : pages
}

function buildRenderedPreviewPage(blocks: RenderedPreviewBlock[]): RenderedPreviewPage {
    return {
        html: blocks.map((entry) => entry.html).join("\n\n"),
        visibleText: blocks.map((entry) => entry.visibleText).join("\n\n"),
    }
}

function chunkVisibleText(text: string): string[] {
    if (text.length <= PREVIEW_BLOCK_TEXT_CHUNK_LIMIT) {
        return [text]
    }

    const chunks: string[] = []
    let remaining = text
    while (remaining.length > PREVIEW_BLOCK_TEXT_CHUNK_LIMIT) {
        let splitAt = remaining.lastIndexOf("\n", PREVIEW_BLOCK_TEXT_CHUNK_LIMIT)
        if (splitAt <= 0) {
            splitAt = PREVIEW_BLOCK_TEXT_CHUNK_LIMIT
        }

        chunks.push(remaining.slice(0, splitAt))
        remaining = remaining.slice(splitAt).replace(/^\n+/u, "")
    }

    if (remaining.length > 0) {
        chunks.push(remaining)
    }

    return chunks
}

function buildPaginationRow(input: {
    page: number
    pageCount: number
    previousLabel: string
    previousData: string
    nextLabel: string
    nextData: string
}): TelegramInlineKeyboardButton[] {
    const row: TelegramInlineKeyboardButton[] = []
    if (input.page > 0) {
        row.push({
            text: input.previousLabel,
            callback_data: input.previousData,
        })
    }
    row.push({
        text: `${input.page + 1}/${input.pageCount}`,
        callback_data: TOOL_VIEW_NOOP_DATA,
    })
    if (input.page < input.pageCount - 1) {
        row.push({
            text: input.nextLabel,
            callback_data: input.nextData,
        })
    }

    return row
}

function normalizeVisibleText(value: string | null): string | null {
    if (value === null || value.trim().length === 0) {
        return null
    }

    return value
}

function formatToolSummary(sections: TelegramToolSection[]): string {
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

function paginateToolSections(sections: TelegramToolSection[]): TelegramToolSection[][] {
    if (sections.length === 0) {
        return []
    }

    const newestFirst = [...sections].reverse()
    const pages: TelegramToolSection[][] = []
    let currentPage: TelegramToolSection[] = []
    let currentLength = 0

    for (const section of newestFirst) {
        const sectionLength = visibleTelegramToolSectionLength(section)
        const nextLength = currentPage.length === 0 ? sectionLength : currentLength + 2 + sectionLength
        if (currentPage.length > 0 && nextLength > TELEGRAM_VISIBLE_TEXT_LIMIT) {
            pages.push(currentPage)
            currentPage = [section]
            currentLength = sectionLength
            continue
        }

        currentPage.push(section)
        currentLength = nextLength
    }

    if (currentPage.length > 0) {
        pages.push(currentPage)
    }

    return pages
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
