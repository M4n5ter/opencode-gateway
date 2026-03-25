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
    const seenParts: unknown[] = []
    const adapter = new OpencodeSdkAdapter(
        {
            session: {
                async promptAsync(input: { body: { messageID: string; parts: unknown[] } }) {
                    seenMessageIds.push(input.body.messageID)
                    seenParts.push(...input.body.parts)
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
            parts: [
                {
                    kind: "text",
                    partId: "prt_gateway_mailbox_1_0",
                    text: "hello",
                },
                {
                    kind: "file",
                    partId: "prt_gateway_mailbox_1_1",
                    mimeType: "image/png",
                    fileName: "photo.png",
                    localPath: "/tmp/photo.png",
                },
            ],
        }),
    ).toEqual({
        kind: "sendPromptAsync",
        sessionId: "ses_1",
    })
    expect(seenMessageIds).toEqual(["msg_gateway_mailbox_1"])
    expect(seenParts).toEqual([
        {
            id: "prt_gateway_mailbox_1_0",
            type: "text",
            text: "hello",
        },
        {
            id: "prt_gateway_mailbox_1_1",
            type: "file",
            mime: "image/png",
            url: "file:///tmp/photo.png",
            filename: "photo.png",
        },
    ])
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
    expect(calls).toBeGreaterThanOrEqual(3)
})

test("OpencodeSdkAdapter ignores a trailing empty assistant stub when waiting for the final response", async () => {
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
                                              id: "msg_assistant_final",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "stop",
                                          },
                                          parts: [
                                              {
                                                  id: "part_1",
                                                  messageID: "msg_assistant_final",
                                                  type: "text",
                                                  text: "final answer",
                                              },
                                          ],
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
                                              id: "msg_assistant_final",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "stop",
                                          },
                                          parts: [
                                              {
                                                  id: "part_1",
                                                  messageID: "msg_assistant_final",
                                                  type: "text",
                                                  text: "final answer",
                                              },
                                          ],
                                      },
                                      {
                                          info: {
                                              id: "msg_assistant_empty",
                                              role: "assistant",
                                              parentID: "msg_user_1",
                                              finish: "stop",
                                          },
                                          parts: [],
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
        messageId: "msg_assistant_final",
        parts: [
            {
                messageId: "msg_assistant_final",
                partId: "part_1",
                type: "text",
                text: "final answer",
                ignored: false,
            },
        ],
    })
    expect(calls).toBeGreaterThanOrEqual(2)
})

test("OpencodeSdkAdapter extends the response deadline while the session is still making progress", async () => {
    let calls = 0
    let now = 0
    const originalNow = Date.now
    Date.now = () => now

    try {
        const adapter = new OpencodeSdkAdapter(
            {
                session: {
                    async messages() {
                        calls += 1
                        now += 30_000

                        if (calls < 4) {
                            return {
                                data: [
                                    {
                                        info: {
                                            id: "msg_user_1",
                                            role: "user",
                                        },
                                        parts: [],
                                    },
                                    {
                                        info: {
                                            id: `msg_assistant_tool_${calls}`,
                                            role: "assistant",
                                            parentID: "msg_user_1",
                                            finish: "tool-calls",
                                        },
                                        parts: [],
                                    },
                                ],
                            }
                        }

                        return {
                            data: [
                                {
                                    info: {
                                        id: "msg_user_1",
                                        role: "user",
                                    },
                                    parts: [],
                                },
                                {
                                    info: {
                                        id: "msg_assistant_final",
                                        role: "assistant",
                                        parentID: "msg_user_1",
                                        finish: "stop",
                                    },
                                    parts: [
                                        {
                                            id: "part_final",
                                            messageID: "msg_assistant_final",
                                            type: "text",
                                            text: "final answer",
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
            messageId: "msg_assistant_final",
            parts: [
                {
                    messageId: "msg_assistant_final",
                    partId: "part_final",
                    type: "text",
                    text: "final answer",
                    ignored: false,
                },
            ],
        })
        expect(calls).toBe(5)
    } finally {
        Date.now = originalNow
    }
})
