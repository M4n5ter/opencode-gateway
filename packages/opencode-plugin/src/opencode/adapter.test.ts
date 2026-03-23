import { expect, test } from "bun:test"

import { OpencodeSdkAdapter } from "./adapter"

test("OpencodeSdkAdapter reports missing sessions through lookupSession without throwing", async () => {
    const adapter = new OpencodeSdkAdapter(
        {
            session: {
                async get() {
                    throw {
                        name: "NotFoundError",
                        data: {
                            message: "Session not found: ses_missing",
                        },
                    }
                },
            },
        } as never,
        "/workspace",
    )

    expect(
        await adapter.execute({
            kind: "lookupSession",
            sessionId: "ses_missing",
        }),
    ).toEqual({
        kind: "lookupSession",
        sessionId: "ses_missing",
        found: false,
    })
})

test("OpencodeSdkAdapter maps sendPromptAsync to session.promptAsync", async () => {
    const seenMessageIds: string[] = []
    const adapter = new OpencodeSdkAdapter(
        {
            session: {
                async promptAsync(input: { body: { messageID: string } }) {
                    seenMessageIds.push(input.body.messageID)
                    return undefined
                },
            },
        } as never,
        "/workspace",
    )

    expect(
        await adapter.execute({
            kind: "sendPromptAsync",
            sessionId: "ses_1",
            messageId: "msg_gateway_mailbox_1",
            textPartId: "prt_gateway_mailbox_1",
            prompt: "hello",
        }),
    ).toEqual({
        kind: "sendPromptAsync",
        sessionId: "ses_1",
    })
    expect(seenMessageIds).toEqual(["msg_gateway_mailbox_1"])
})

test("OpencodeSdkAdapter waits for the final assistant child message", async () => {
    let calls = 0
    const adapter = new OpencodeSdkAdapter(
        {
            session: {
                async messages() {
                    calls += 1
                    return {
                        data:
                            calls === 1
                                ? [
                                      {
                                          info: {
                                              id: "msg_user_1",
                                              role: "user",
                                          },
                                          parts: [],
                                      },
                                      {
                                          info: {
                                              id: "msg_assistant_tool",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "tool-calls",
                                          },
                                          parts: [],
                                      },
                                  ]
                                : [
                                      {
                                          info: {
                                              id: "msg_user_1",
                                              role: "user",
                                          },
                                          parts: [],
                                      },
                                      {
                                          info: {
                                              id: "msg_assistant_tool",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "tool-calls",
                                          },
                                          parts: [],
                                      },
                                      {
                                          info: {
                                              id: "msg_assistant_1",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "stop",
                                          },
                                          parts: [
                                              {
                                                  id: "part_1",
                                                  messageID: "msg_assistant_1",
                                                  type: "text",
                                                  text: "    code line",
                                              },
                                          ],
                                      },
                                  ],
                    }
                },
            },
        } as never,
        "/workspace",
    )

    expect(
        await adapter.execute({
            kind: "awaitPromptResponse",
            sessionId: "ses_1",
            messageId: "msg_user_1",
        }),
    ).toEqual({
        kind: "awaitPromptResponse",
        sessionId: "ses_1",
        messageId: "msg_assistant_1",
        parts: [
            {
                messageId: "msg_assistant_1",
                partId: "part_1",
                type: "text",
                text: "    code line",
                ignored: false,
            },
        ],
    })
    expect(calls).toBe(2)
})
