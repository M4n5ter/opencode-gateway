import { expect, test } from "bun:test"

import type {
    OpencodeSdkAdapter,
    OpencodeSessionMessageRecord,
    OpencodeSessionRecord,
} from "../opencode/adapter"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewaySessionSearchRuntime } from "./search"

test("GatewaySessionSearchRuntime searches only gateway-managed sessions across text-like parts", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "session-current", 20)
        store.replaceSessionReplyTargets({
            sessionId: "session-current",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 20,
        })
        store.replaceSessionReplyTargets({
            sessionId: "session-old",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 10,
        })

        const runtime = new GatewaySessionSearchRuntime(
            store,
            createMockOpencode(
                [
                    createSession("session-current", "Current", 1, 100),
                    createSession("session-old", "Old", 2, 90),
                    createSession("session-other", "Other", 3, 80),
                ],
                {
                    "session-current": [
                        createMessage("msg-1", "user", 10, [
                            {
                                id: "part-1",
                                type: "text",
                                text: "visible needle",
                            },
                        ]),
                        createMessage("msg-2", "assistant", 20, [
                            {
                                id: "part-2",
                                type: "tool",
                                tool: "bash",
                                state: {
                                    status: "completed",
                                    output: "tool needle output",
                                    attachments: [
                                        {
                                            id: "attachment-1",
                                            type: "file",
                                            filename: "needle.png",
                                            mime: "image/png",
                                            url: "file:///needle.png",
                                            source: {
                                                path: "/tmp/needle.txt",
                                                text: {
                                                    value: "attachment source needle",
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        ]),
                    ],
                    "session-old": [
                        createMessage("msg-3", "assistant", 30, [
                            {
                                id: "part-3",
                                type: "reasoning",
                                text: "reasoning needle",
                            },
                            {
                                id: "part-4",
                                type: "file",
                                filename: "report.md",
                                mime: "text/markdown",
                                source: {
                                    path: "/docs/needle.md",
                                    text: {
                                        value: "file source needle",
                                    },
                                },
                            },
                        ]),
                    ],
                    "session-other": [
                        createMessage("msg-4", "assistant", 40, [
                            {
                                id: "part-5",
                                type: "text",
                                text: "needle from unmanaged session",
                            },
                        ]),
                    ],
                },
            ),
        )

        const result = await runtime.search("needle", {
            limit: 10,
        })

        expect(result.scannedSessions).toBe(2)
        expect(result.skippedDeletedSessionIds).toEqual([])
        expect(new Set(result.hits.map((hit) => hit.sessionId))).toEqual(new Set(["session-current", "session-old"]))
        expect(new Set(result.hits.map((hit) => hit.partType))).toEqual(
            new Set(["text", "tool", "tool_attachment", "reasoning", "file"]),
        )

        const truncated = await runtime.search("needle", {
            sessionId: "session-current",
            messageLimit: 1,
            limit: 10,
        })
        expect(truncated.maybeTruncatedSessionIds).toEqual(["session-current"])
    } finally {
        db.close()
    }
})

test("GatewaySessionSearchRuntime lists gateway sessions with pagination and deleted filtering", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "session-current", 30)
        store.replaceSessionReplyTargets({
            sessionId: "session-current",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 30,
        })
        store.replaceSessionReplyTargets({
            sessionId: "session-old",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 20,
        })
        store.replaceSessionReplyTargets({
            sessionId: "session-deleted",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 10,
        })

        const runtime = new GatewaySessionSearchRuntime(
            store,
            createMockOpencode(
                [
                    createSession("session-current", "Current", 1, 100),
                    createSession("session-old", "Old", 2, 90),
                ],
                {},
            ),
        )

        const defaultList = await runtime.list({
            limit: 1,
        })
        expect(defaultList.totalCount).toBe(2)
        expect(defaultList.returnedCount).toBe(1)
        expect(defaultList.nextOffset).toBe(1)
        expect(defaultList.activeCount).toBe(2)
        expect(defaultList.deletedCount).toBe(1)
        expect(defaultList.sessions[0]).toMatchObject({
            sessionId: "session-current",
            status: "active",
            isCurrentBinding: true,
        })

        const withDeleted = await runtime.list({
            includeDeleted: true,
            offset: 2,
            limit: 2,
        })
        expect(withDeleted.totalCount).toBe(3)
        expect(withDeleted.returnedCount).toBe(1)
        expect(withDeleted.sessions[0]).toMatchObject({
            sessionId: "session-deleted",
            status: "deleted",
            sessionTitle: null,
        })
    } finally {
        db.close()
    }
})

test("GatewaySessionSearchRuntime views sessions with offset pagination and content filters", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "session-current", 20)
        store.replaceSessionReplyTargets({
            sessionId: "session-current",
            conversationKey: "telegram:42",
            targets: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            recordedAtMs: 20,
        })

        const runtime = new GatewaySessionSearchRuntime(
            store,
            createMockOpencode([createSession("session-current", "Current", 1, 100)], {
                "session-current": [
                    createMessage("msg-1", "user", 10, [
                        {
                            id: "part-1",
                            type: "text",
                            text: "hello",
                        },
                    ]),
                    createMessage("msg-2", "assistant", 20, [
                        {
                            id: "part-2",
                            type: "reasoning",
                            text: "hidden reasoning",
                        },
                    ]),
                    createMessage("msg-3", "assistant", 30, [
                        {
                            id: "part-3",
                            type: "tool",
                            tool: "bash",
                            state: {
                                status: "completed",
                                output: "tool output",
                                attachments: [
                                    {
                                        id: "attachment-1",
                                        type: "file",
                                        filename: "artifact.txt",
                                        mime: "text/plain",
                                    },
                                ],
                            },
                        },
                    ]),
                ],
            }),
        )

        const defaultView = await runtime.view({
            sessionId: "session-current",
            offset: 1,
            messageLimit: 2,
        })
        expect(defaultView.offset).toBe(1)
        expect(defaultView.returnedCount).toBe(2)
        expect(defaultView.nextOffset).toBe(null)
        expect(defaultView.prevOffset).toBe(0)
        expect(defaultView.visibleParts).toEqual(["text", "tools", "tool_outputs"])
        expect(defaultView.messages[0]?.messageId).toBe("msg-2")
        expect(defaultView.messages[0]?.parts).toEqual([])
        expect(defaultView.messages[1]?.parts[0]).toMatchObject({
            type: "tool",
        })
        expect(defaultView.messages[1]?.parts[0]?.body).toContain("tool output")
        expect(defaultView.messages[1]?.parts[0]?.body).not.toContain("attachments:")

        const expandedView = await runtime.view({
            sessionId: "session-current",
            offset: 1,
            messageLimit: 2,
            includeReasoning: true,
            includeAttachments: true,
        })
        expect(expandedView.messages[0]?.parts[0]).toMatchObject({
            type: "reasoning",
        })
        expect(expandedView.messages[1]?.parts[0]?.body).toContain("attachments:")
    } finally {
        db.close()
    }
})

test("GatewaySessionSearchRuntime rejects unmanaged sessions", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const runtime = new GatewaySessionSearchRuntime(store, createMockOpencode([], {}))

        await expect(
            runtime.view({
                sessionId: "session-unmanaged",
            }),
        ).rejects.toThrow("requested session is not managed by the gateway")
    } finally {
        db.close()
    }
})

function createMockOpencode(
    sessions: OpencodeSessionRecord[],
    messagesBySessionId: Record<string, OpencodeSessionMessageRecord[]>,
): Pick<OpencodeSdkAdapter, "listSessions" | "getSession" | "listSessionMessages"> {
    return {
        async listSessions() {
            return sessions
        },
        async getSession(sessionId: string) {
            return sessions.find((session) => session.id === sessionId) ?? null
        },
        async listSessionMessages(sessionId: string, limit?: number) {
            const messages = messagesBySessionId[sessionId] ?? []
            return limit === undefined ? messages : messages.slice(0, limit)
        },
    }
}

function createSession(id: string, title: string, createdAtMs: number, updatedAtMs: number): OpencodeSessionRecord {
    return {
        id,
        title,
        parentId: null,
        createdAtMs,
        updatedAtMs,
    }
}

function createMessage(
    messageId: string,
    role: string,
    createdAtMs: number,
    parts: Array<Record<string, unknown>>,
): OpencodeSessionMessageRecord {
    return {
        messageId,
        role,
        parentId: null,
        createdAtMs,
        completedAtMs: null,
        finish: null,
        errorMessage: null,
        parts,
    }
}
