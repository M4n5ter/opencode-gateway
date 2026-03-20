import { expect, test } from "bun:test"

import type { BindingPromptRequest } from "../binding"
import { OpencodeEventHub } from "../opencode/events"
import { GatewayOpencodeHost } from "./opencode"

test("GatewayOpencodeHost recreates a missing persisted session before prompting", async () => {
    const seenPromptSessionIds: string[] = []
    const host = new GatewayOpencodeHost(
        {
            session: {
                async create() {
                    return {
                        data: {
                            id: "ses_fresh",
                        },
                    }
                },
                async get() {
                    throw {
                        name: "NotFoundError",
                        data: {
                            message: "Session not found: ses_stale",
                        },
                    }
                },
                async prompt(input: { path: { id: string } }) {
                    seenPromptSessionIds.push(input.path.id)
                    return {
                        data: {
                            info: { id: "msg_assistant_1" },
                            parts: [{ messageID: "old-message", type: "text", text: "stale" }],
                        },
                    }
                },
                async message(input: { path: { id: string; messageID: string } }) {
                    expect(input.path.id).toBe("ses_fresh")
                    expect(input.path.messageID).toBe("msg_assistant_1")
                    return {
                        data: {
                            parts: [{ messageID: "msg_assistant_1", type: "text", text: "hello back" }],
                        },
                    }
                },
            },
        } as never,
        "/tmp",
        new OpencodeEventHub(),
    )

    const result = await host.runPrompt(createRequest("ses_stale"))

    expect(seenPromptSessionIds).toEqual(["ses_fresh"])
    expect(result.sessionId).toBe("ses_fresh")
    expect(result.responseText).toBe("hello back")
    expect(result.errorMessage).toBeNull()
})

function createRequest(sessionId: string): BindingPromptRequest {
    return {
        conversationKey: "telegram:42",
        prompt: "hello",
        sessionId,
    }
}
