import { expect, test } from "bun:test"

import type { BindingExecutionObservation } from "../binding"
import { OpencodeEventStream } from "./event-stream"
import { OpencodeEventHub } from "./events"

test("OpencodeEventStream forwards SDK SSE events into the prompt hub", async () => {
    const hub = new OpencodeEventHub()
    const observations: BindingExecutionObservation[] = []
    const registration = hub.registerPrompt(
        "session-1",
        {
            observeEvent(observation) {
                observations.push(observation)
                return {
                    kind:
                        observation.kind === "textPartUpdated" && observation.messageId === "msg_assistant_1"
                            ? "preview"
                            : "noop",
                    text:
                        observation.kind === "textPartUpdated" && observation.messageId === "msg_assistant_1"
                            ? "hello"
                            : null,
                }
            },
            finish() {
                return {
                    kind: "noop",
                    text: null,
                }
            },
        },
        "msg_user_1",
        () => {},
    )

    const runtime = new OpencodeEventStream(
        {
            event: {
                async subscribe() {
                    return {
                        stream: streamEvents([
                            createUserMessageUpdatedEvent("session-1", "msg_user_1"),
                            createAssistantMessageUpdatedEvent("session-1", "msg_assistant_1", "msg_user_1"),
                            createUpdatedPartEvent("session-1", "msg_assistant_1", "part-1", "hello"),
                        ]),
                    }
                },
            },
        } as never,
        "/workspace",
        hub,
        createLogger(),
    )

    runtime.start()
    await Bun.sleep(20)
    runtime.stop()
    registration.dispose()

    expect(observations.some((observation) => observation.kind === "messageUpdated")).toBe(true)
    expect(observations.some((observation) => observation.kind === "textPartUpdated")).toBe(true)
    expect(runtime.isConnected()).toBe(false)
    expect(runtime.lastStreamError()).toBeNull()
})

function streamEvents(events: unknown[]): AsyncGenerator<unknown, void, unknown> {
    return (async function* () {
        for (const event of events) {
            yield event
        }
    })()
}

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

function createLogger() {
    return {
        log() {},
    }
}
