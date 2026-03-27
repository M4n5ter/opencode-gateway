import { expect, test } from "bun:test"

import {
    buildTelegramStreamReplyMarkup,
    renderTelegramFinalMessage,
    renderTelegramStreamMessage,
    renderTelegramStreamMessageForView,
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

test("renderTelegramStreamMessage renders tool sections as sibling expandable blocks", () => {
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

test("renderTelegramStreamMessageForView keeps tool sections collapsed behind a summary by default", () => {
    expect(
        renderTelegramStreamMessageForView(
            {
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
            },
            {
                toolCallView: "toggle",
                toolVisibility: "collapsed",
            },
        ),
    ).toBe(
        "<blockquote expandable><i>I should check memory first</i></blockquote>\n\n<blockquote>Fetching data</blockquote>\n\n<i>Tools: 1 completed</i>\n\nDone",
    )

    expect(
        buildTelegramStreamReplyMarkup(
            {
                processText: null,
                reasoningText: null,
                answerText: null,
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
            },
            {
                toolCallView: "toggle",
                toolVisibility: "collapsed",
            },
        ),
    ).toEqual({
        inline_keyboard: [[{ text: "Show Tools (1)", callback_data: "tv:show" }]],
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
