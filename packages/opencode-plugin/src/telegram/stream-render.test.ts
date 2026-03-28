import { expect, test } from "bun:test"

import { extractVisibleTelegramHtmlText } from "./markdown"
import {
    buildTelegramStreamReplyMarkup,
    renderTelegramFinalMessage,
    renderTelegramStreamMessage,
    renderTelegramStreamMessageForView,
    resolveTelegramPreviewViewState,
} from "./stream-render"

test("renderTelegramStreamMessage places reasoning into an expandable italic blockquote", () => {
    expect(
        renderTelegramStreamMessage({
            processText: "Fetching data",
            reasoningText: "I should check memory first",
            answerText: "Done",
        }),
    ).toBe(
        "<blockquote expandable><i>I should check memory first</i></blockquote>\n\n<blockquote>Fetching data</blockquote>\n\nDone",
    )
})

test("renderTelegramStreamMessage renders tool sections as sibling expandable blocks in inline mode", () => {
    expect(
        renderTelegramStreamMessage({
            processText: "Fetching data",
            reasoningText: "I should check memory first",
            answerText: "Done",
            toolSections: [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "completed",
                    title: "List repos",
                    inputText: '{"cmd":"gh repo list"}',
                    outputText: "repo-a\nrepo-b",
                    errorText: null,
                },
            ],
        }),
    ).toBe(
        '<blockquote expandable><i>I should check memory first</i></blockquote>\n\n<blockquote>Fetching data</blockquote>\n\n<b>List repos</b> <i>completed</i>\n<blockquote expandable>Input\n{"cmd":"gh repo list"}\n\nOutput\nrepo-a\nrepo-b</blockquote>\n\nDone',
    )
})

test("toggle preview mode preserves reasoning, process, and answer instead of rendering tool sections inline", () => {
    const preview = {
        processText: "Fetching data",
        reasoningText: "I should check memory first",
        answerText: "Done",
        toolSections: [
            {
                callId: "call-1",
                toolName: "bash",
                status: "completed",
                title: "List repos",
                inputText: '{"cmd":"gh repo list"}',
                outputText: "repo-a\nrepo-b",
                errorText: null,
            },
        ],
    }

    expect(
        renderTelegramStreamMessageForView(preview, {
            toolCallView: "toggle",
            viewState: {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            },
        }),
    ).toBe(
        "<blockquote expandable><i>I should check memory first</i></blockquote>\n\n<blockquote>Fetching data</blockquote>\n\nDone",
    )

    expect(
        buildTelegramStreamReplyMarkup(preview, {
            toolCallView: "toggle",
            viewState: {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            },
        }),
    ).toEqual({
        inline_keyboard: [
            [
                { text: "• Preview", callback_data: "tv:preview" },
                { text: "Tools (1)", callback_data: "tv:tools" },
            ],
        ],
    })
})

test("toggle preview mode falls back to a small tool summary when no preview text exists yet", () => {
    expect(
        renderTelegramStreamMessageForView(
            {
                processText: null,
                reasoningText: null,
                answerText: null,
                toolSections: [
                    {
                        callId: "call-1",
                        toolName: "bash",
                        status: "running",
                        title: "List repos",
                        inputText: '{"cmd":"gh repo list"}',
                        outputText: null,
                        errorText: null,
                    },
                ],
            },
            {
                toolCallView: "toggle",
                viewState: {
                    viewMode: "preview",
                    previewPage: 0,
                    toolsPage: 0,
                },
            },
        ),
    ).toBe("<i>Tools: 1 running</i>")
})

test("toggle tools mode paginates newest tool sections without dropping preview state", () => {
    const longInput = "x".repeat(900)
    const preview = {
        processText: "Fetching data",
        reasoningText: "I should check memory first",
        answerText: "Done",
        toolSections: Array.from({ length: 6 }, (_, index) => ({
            callId: `call-${index + 1}`,
            toolName: "bash",
            status: "completed" as const,
            title: `Step ${index + 1}`,
            inputText: longInput,
            outputText: null,
            errorText: null,
        })),
    }

    const rendered = renderTelegramStreamMessageForView(preview, {
        toolCallView: "toggle",
        viewState: {
            viewMode: "tools",
            previewPage: 0,
            toolsPage: 0,
        },
    })

    expect(rendered).toContain("<b>Step 6</b>")
    expect(rendered).not.toContain("<blockquote>Fetching data</blockquote>")
    expect(rendered).not.toContain("<b>Step 1</b>")
    expect(
        buildTelegramStreamReplyMarkup(preview, {
            toolCallView: "toggle",
            viewState: {
                viewMode: "tools",
                previewPage: 0,
                toolsPage: 0,
            },
        }),
    ).toEqual({
        inline_keyboard: [
            [
                { text: "Preview", callback_data: "tv:preview" },
                { text: "• Tools (6)", callback_data: "tv:tools" },
            ],
            [
                { text: "1/2", callback_data: "tv:noop" },
                { text: "Older", callback_data: "tv:older" },
            ],
        ],
    })
})

test("renderTelegramFinalMessage renders common markdown into Telegram HTML", () => {
    expect(
        renderTelegramFinalMessage("# Title\n\n**bold** and `code`\n\n- a\n- b\n\n[link](https://example.com)"),
    ).toBe('<b>Title</b>\n\n<b>bold</b> and <code>code</code>\n\n• a\n• b\n\n<a href="https://example.com/">link</a>')
})

test("renderTelegramStreamMessage drops reasoning before process text when the preview is too long", () => {
    const longReasoning = "r".repeat(3_000)
    const longProcess = "p".repeat(1_500)
    const answer = "done"

    expect(
        renderTelegramStreamMessage({
            processText: longProcess,
            reasoningText: longReasoning,
            answerText: answer,
        }),
    ).toBe(`<blockquote>${longProcess}</blockquote>\n\ndone`)
})

test("toggle preview mode paginates long preview bodies and omits pagination when not needed", () => {
    const preview = {
        processText: "Working",
        reasoningText: null,
        answerText: ["alpha", "x".repeat(3500), "omega", "y".repeat(1200)].join("\n\n"),
        toolSections: [],
    }

    expect(
        renderTelegramStreamMessageForView(preview, {
            toolCallView: "toggle",
            viewState: {
                viewMode: "preview",
                previewPage: 1,
                toolsPage: 0,
            },
        }),
    ).toContain("yyyy")

    expect(
        buildTelegramStreamReplyMarkup(preview, {
            toolCallView: "toggle",
            viewState: {
                viewMode: "preview",
                previewPage: 0,
                toolsPage: 0,
            },
        }),
    ).toEqual({
        inline_keyboard: [
            [
                { text: "1/2", callback_data: "tv:noop" },
                { text: "Next", callback_data: "tv:preview_next" },
            ],
        ],
    })

    expect(
        buildTelegramStreamReplyMarkup(
            {
                processText: "short",
                reasoningText: null,
                answerText: "done",
                toolSections: [],
            },
            {
                toolCallView: "toggle",
                viewState: {
                    viewMode: "preview",
                    previewPage: 0,
                    toolsPage: 0,
                },
            },
        ),
    ).toBeNull()
})

test("toggle preview pagination keeps the tail of a long answer reachable on the last page", () => {
    const answerText = [
        "# Title",
        "",
        "Alpha paragraph",
        "",
        "```text",
        "x".repeat(4_600),
        "```",
        "",
        "- item a",
        "- item b",
        "",
        "omega",
    ].join("\n")
    const preview = {
        processText: "Working through the request",
        reasoningText: "Need to keep the preview lossless while paginating",
        answerText,
        toolSections: [],
    }

    const initialState = resolveTelegramPreviewViewState(preview, {
        toolCallView: "toggle",
        viewState: {
            viewMode: "preview",
            previewPage: 0,
            toolsPage: 0,
        },
    })
    const lastPage = resolveTelegramPreviewViewState(preview, {
        toolCallView: "toggle",
        viewState: {
            viewMode: "preview",
            previewPage: initialState.previewPageCount - 1,
            toolsPage: 0,
        },
    }).previewBody

    expect(initialState.previewPageCount).toBeGreaterThan(1)
    expect(extractVisibleTelegramHtmlText(lastPage)).toContain("omega")
    expect(extractVisibleTelegramHtmlText(lastPage)).toContain("• item a")
    expect(extractVisibleTelegramHtmlText(lastPage)).toContain("• item b")
})
