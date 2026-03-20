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

test("streamPromptText builds preview snapshots from event deltas before final text exists", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()

    const client = {
        session: {
            async prompt() {
                const userMessageId = "msg_user_1"
                const assistantMessageId = "msg_assistant_2"

                await events.handleEvent(createUserMessageUpdatedEvent("session-1", userMessageId))
                await events.handleEvent(
                    createAssistantMessageUpdatedEvent("session-1", assistantMessageId, userMessageId),
                )
                await events.handleEvent(createDeltaPartEvent("session-1", assistantMessageId, "part-1", "hel"))
                await events.handleEvent(createDeltaPartEvent("session-1", assistantMessageId, "part-1", "lo"))

                return {
                    data: {
                        info: { id: assistantMessageId },
                        parts: [],
                    },
                }
            },
            async message(input: { path: { messageID: string } }) {
                expect(input.path.messageID).toBe("msg_assistant_2")
                return {
                    data: {
                        parts: [{ messageID: "msg_assistant_2", type: "text", text: "hello world" }],
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

test("streamPromptText waits briefly for preview establishment after prompt returns", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()
    const assistantMessageId = "msg_assistant_delayed"
    const userMessageId = "msg_user_delayed"

    const client = {
        session: {
            async prompt() {
                setTimeout(() => {
                    void events.handleEvent(createUserMessageUpdatedEvent("session-1", userMessageId))
                    void events.handleEvent(
                        createAssistantMessageUpdatedEvent("session-1", assistantMessageId, userMessageId),
                    )
                    void events.handleEvent(createDeltaPartEvent("session-1", assistantMessageId, "part-1", "hel"))
                }, 50)

                return {
                    data: {
                        info: { id: assistantMessageId },
                        parts: [],
                    },
                }
            },
            async message() {
                return {
                    data: {
                        parts: [{ messageID: assistantMessageId, type: "text", text: "hello world" }],
                    },
                }
            },
        },
    }

    const started = Date.now()
    const result = await streamPromptText(client as never, "/workspace", events, "session-1", "hello", async (text) => {
        snapshots.push(text)
    })

    expect(result).toBe("hello world")
    expect(snapshots).toEqual(["hel"])
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
})

test("event hub keeps processing later deltas while an earlier snapshot handler is still pending", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()
    let firstSnapshotReleased = false
    let releaseFirstSnapshot: () => void = () => {
        firstSnapshotReleased = true
    }
    let firstSnapshot = true

    const registration = events.registerPrompt("session-1", async (text) => {
        snapshots.push(text)
        if (firstSnapshot) {
            firstSnapshot = false
            await new Promise<void>((resolve) => {
                releaseFirstSnapshot = resolve
            })
        }
    })

    try {
        events.handleEvent(createUserMessageUpdatedEvent("session-1", "msg_user_1"))
        events.handleEvent(createAssistantMessageUpdatedEvent("session-1", "msg_assistant_3", "msg_user_1"))
        events.handleEvent(createDeltaPartEvent("session-1", "msg_assistant_3", "part-1", "hel"))
        events.handleEvent(createDeltaPartEvent("session-1", "msg_assistant_3", "part-1", "lo"))

        expect(snapshots).toEqual(["hel", "hello"])
    } finally {
        if (!firstSnapshotReleased) {
            releaseFirstSnapshot()
        }
        registration.dispose()
    }
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

function createUserMessageUpdatedEvent(sessionID: string, id: string) {
    return {
        type: "message.updated" as const,
        properties: {
            info: {
                sessionID,
                id,
                role: "user" as const,
            },
        },
    }
}

function createDeltaPartEvent(sessionID: string, messageID: string, id: string, delta: string) {
    return {
        type: "message.part.updated" as const,
        properties: {
            part: {
                id,
                sessionID,
                messageID,
                type: "text",
                text: null,
            },
            delta,
        },
    }
}
