import { expect, test } from "bun:test"

import { OpencodeEventHub } from "./events"
import { streamPromptText } from "./stream"

test("streamPromptText routes preview events by session and message identifiers", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()

    const client = {
        session: {
            async prompt() {
                const assistantMessageId = "msg_assistant_1"

                await events.handleEvent(
                    createUpdatedPartEvent("session-2", "other-message", "ignored-session", "wrong session"),
                )
                await events.handleEvent(
                    createUpdatedPartEvent("session-1", "other-message", "ignored-message", "wrong message"),
                )
                await events.handleEvent(
                    createAssistantMessageUpdatedEvent("session-1", assistantMessageId, "msg_user_unused"),
                )
                await events.handleEvent(createUpdatedPartEvent("session-1", assistantMessageId, "part-1", "hel"))
                await events.handleEvent(createUpdatedPartEvent("session-1", assistantMessageId, "part-1", "hello"))

                return {
                    data: {
                        info: { id: assistantMessageId },
                        parts: [{ messageID: "old-message", type: "text", text: "stale" }],
                    },
                }
            },
            async message(input: { path: { messageID: string } }) {
                expect(input.path.messageID).toBe("msg_assistant_1")
                return {
                    data: {
                        parts: [{ messageID: "msg_assistant_1", type: "text", text: "hello world" }],
                    },
                }
            },
        },
    }

    const result = await streamPromptText(client as never, "/workspace", events, "session-1", "hello", async (text) => {
        snapshots.push(text)
    })

    expect(result).toBe("hello world")
    expect(snapshots).toEqual(["hel", "hello"])
})

test("streamPromptText keeps the final response on the prompt path even without preview events", async () => {
    const events = new OpencodeEventHub()
    let promptCount = 0

    const client = {
        session: {
            async prompt() {
                promptCount += 1

                return {
                    data: {
                        info: { id: "msg_assistant_2" },
                        parts: [{ type: "text", text: "final fallback" }],
                    },
                }
            },
            async message() {
                return {
                    data: {
                        parts: [{ messageID: "msg_assistant_2", type: "text", text: "final fallback" }],
                    },
                }
            },
        },
    }

    const result = await streamPromptText(client as never, "/workspace", events, "session-1", "hello", async () => {})

    expect(result).toBe("final fallback")
    expect(promptCount).toBe(1)
})

function createUpdatedPartEvent(sessionID: string, messageID: string, id: string, text: string) {
    return {
        type: "message.part.updated" as const,
        properties: {
            part: {
                id,
                sessionID,
                messageID,
                type: "text",
                text,
            },
        },
    }
}

function createAssistantMessageUpdatedEvent(sessionID: string, id: string, parentID: string) {
    return {
        type: "message.updated" as const,
        properties: {
            info: {
                sessionID,
                id,
                role: "assistant" as const,
                parentID,
            },
        },
    }
}
