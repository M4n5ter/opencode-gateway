import { expect, test } from "bun:test"

import { renderTelegramFinalMessage, renderTelegramStreamMessage } from "./stream-render"

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
