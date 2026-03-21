import { expect, test } from "bun:test"

import type { BindingExecutionObservation, BindingProgressiveDirective, ExecutionHandle } from "../binding"
import { OpencodeEventHub } from "./events"
import { streamPromptText } from "./stream"

const PROMPT_IDS = {
    messageId: "msg_user_1",
    textPartId: "prt_user_1",
}

test("streamPromptText forwards session events into the execution handle and returns the final message text", async () => {
    const snapshots: string[] = []
    const observations: BindingExecutionObservation[] = []
    const events = new OpencodeEventHub()
    const execution = createExecutionHandle((observation) => {
        observations.push(observation)

        if (
            observation.kind === "textPartUpdated" &&
            observation.sessionId === "session-1" &&
            observation.messageId === "msg_assistant_1" &&
            observation.delta === "hel"
        ) {
            return preview("hel")
        }

        if (
            observation.kind === "textPartDelta" &&
            observation.messageId === "msg_assistant_1" &&
            observation.delta === "lo"
        ) {
            return preview("hello")
        }

        return noop()
    })

    const client = {
        session: {
            async promptAsync() {
                events.handleEvent(createUserMessageUpdatedEvent("session-2", "msg_user_other"))
                events.handleEvent(
                    createAssistantMessageUpdatedEvent("session-2", "msg_assistant_other", "msg_user_other"),
                )
                events.handleEvent(
                    createUpdatedPartEvent("session-2", "msg_assistant_other", "part-other", "wrong", null),
                )
                events.handleEvent(createUserMessageUpdatedEvent("session-1", PROMPT_IDS.messageId))
                events.handleEvent(
                    createAssistantMessageUpdatedEvent("session-1", "msg_assistant_1", PROMPT_IDS.messageId),
                )
                events.handleEvent(createUpdatedPartEvent("session-1", "msg_assistant_1", "part-1", null, "hel"))
                events.handleEvent(createDeltaPartEvent("msg_assistant_1", "part-1", "lo"))
            },
            async status() {
                return {
                    data: {},
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

    const result = await streamPromptText(
        client as never,
        "/workspace",
        events,
        "session-1",
        "hello",
        PROMPT_IDS,
        execution,
        async (text: string) => {
            snapshots.push(text)
        },
    )

    expect(result).toBe("hello world")
    expect(snapshots).toEqual(["hel", "hello"])
    expect(observations.some((observation) => observation.kind === "messageUpdated")).toBe(true)
    expect(observations.some((observation) => observation.kind === "textPartDelta")).toBe(true)
})

test("streamPromptText waits briefly for preview establishment after promptAsync returns", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()
    const execution = createExecutionHandle((observation) => {
        if (
            observation.kind === "textPartUpdated" &&
            observation.sessionId === "session-1" &&
            observation.messageId === "msg_assistant_2" &&
            observation.delta === "hel"
        ) {
            return preview("hel")
        }

        return noop()
    })

    const client = {
        session: {
            async promptAsync() {
                setTimeout(() => {
                    events.handleEvent(createUserMessageUpdatedEvent("session-1", "msg_user_2"))
                    events.handleEvent(createAssistantMessageUpdatedEvent("session-1", "msg_assistant_2", "msg_user_2"))
                    events.handleEvent(createUpdatedPartEvent("session-1", "msg_assistant_2", "part-1", null, "hel"))
                }, 50)
            },
            async status() {
                return {
                    data: {},
                }
            },
            async message() {
                return {
                    data: {
                        parts: [{ messageID: "msg_assistant_2", type: "text", text: "hello world" }],
                    },
                }
            },
        },
    }

    const started = Date.now()
    const result = await streamPromptText(
        client as never,
        "/workspace",
        events,
        "session-1",
        "hello",
        {
            messageId: "msg_user_2",
            textPartId: "prt_user_2",
        },
        execution,
        async (text: string) => {
            snapshots.push(text)
        },
    )

    expect(result).toBe("hello world")
    expect(snapshots).toEqual(["hel"])
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
})

test("event hub keeps processing later observations while an earlier preview handler is still pending", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()
    let releaseFirstSnapshot: (() => void) | undefined
    let firstSnapshot = true

    const registration = events.registerPrompt(
        "session-1",
        createExecutionHandle((observation) => {
            if (
                observation.kind === "textPartUpdated" &&
                observation.messageId === "msg_assistant_3" &&
                observation.delta === "hel"
            ) {
                return preview("hel")
            }

            if (
                observation.kind === "textPartDelta" &&
                observation.messageId === "msg_assistant_3" &&
                observation.delta === "lo"
            ) {
                return preview("hello")
            }

            return noop()
        }),
        "msg_user_3",
        async (text: string) => {
            snapshots.push(text)
            if (firstSnapshot) {
                firstSnapshot = false
                await new Promise<void>((resolve) => {
                    releaseFirstSnapshot = resolve
                })
            }
        },
    )

    try {
        events.handleEvent(createUserMessageUpdatedEvent("session-1", "msg_user_3"))
        events.handleEvent(createAssistantMessageUpdatedEvent("session-1", "msg_assistant_3", "msg_user_3"))
        events.handleEvent(createUpdatedPartEvent("session-1", "msg_assistant_3", "part-1", null, "hel"))
        events.handleEvent(createDeltaPartEvent("msg_assistant_3", "part-1", "lo"))

        expect(snapshots).toEqual(["hel", "hello"])
    } finally {
        releaseFirstSnapshot?.()
        registration.dispose()
    }
})

test("disposing one prompt does not remove a sibling prompt on the same session", async () => {
    const snapshots: string[] = []
    const events = new OpencodeEventHub()
    const staleRegistration = events.registerPrompt(
        "session-1",
        createExecutionHandle(() => noop()),
        "msg_user_stale",
        () => {},
    )
    const activeRegistration = events.registerPrompt(
        "session-1",
        createExecutionHandle((observation) => {
            if (
                observation.kind === "textPartUpdated" &&
                observation.messageId === "msg_assistant_4" &&
                observation.delta === "hello"
            ) {
                return preview("hello")
            }

            return noop()
        }),
        "msg_user_4",
        (text: string) => {
            snapshots.push(text)
        },
    )

    try {
        staleRegistration.dispose()

        events.handleEvent(createUserMessageUpdatedEvent("session-1", "msg_user_4"))
        events.handleEvent(createAssistantMessageUpdatedEvent("session-1", "msg_assistant_4", "msg_user_4"))
        events.handleEvent(createUpdatedPartEvent("session-1", "msg_assistant_4", "part-1", null, "hello"))

        expect(snapshots).toEqual(["hello"])
    } finally {
        activeRegistration.dispose()
    }
})

test("streamPromptText preserves leading whitespace in final text parts", async () => {
    const events = new OpencodeEventHub()
    const execution = createExecutionHandle(() => noop())
    const client = {
        session: {
            async promptAsync() {
                events.handleEvent(createUserMessageUpdatedEvent("session-1", "msg_user_5"))
                events.handleEvent(createAssistantMessageUpdatedEvent("session-1", "msg_assistant_5", "msg_user_5"))
            },
            async status() {
                return {
                    data: {},
                }
            },
            async message() {
                return {
                    data: {
                        parts: [
                            {
                                messageID: "msg_assistant_5",
                                type: "text",
                                text: "  indented line",
                            },
                        ],
                    },
                }
            },
        },
    }

    const result = await streamPromptText(
        client as never,
        "/workspace",
        events,
        "session-1",
        "hello",
        {
            messageId: "msg_user_5",
            textPartId: "prt_user_5",
        },
        execution,
        async () => {},
    )

    expect(result).toBe("  indented line")
})

function createExecutionHandle(
    observeEvent: (observation: BindingExecutionObservation) => BindingProgressiveDirective,
): ExecutionHandle {
    return {
        observeEvent(observation) {
            return observeEvent(observation)
        },
        finish() {
            return noop()
        },
    }
}

function createUpdatedPartEvent(
    sessionID: string,
    messageID: string,
    id: string,
    text: string | null,
    delta: string | null,
) {
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
            delta: delta ?? undefined,
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

function createDeltaPartEvent(messageID: string, partID: string, delta: string) {
    return {
        type: "message.part.delta" as const,
        properties: {
            messageID,
            partID,
            field: "text",
            delta,
        },
    }
}

function preview(text: string): BindingProgressiveDirective {
    return {
        kind: "preview",
        text,
    }
}

function noop(): BindingProgressiveDirective {
    return {
        kind: "noop",
        text: null,
    }
}
