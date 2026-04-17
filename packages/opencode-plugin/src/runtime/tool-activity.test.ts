import { expect, test } from "bun:test"

import { GatewaySessionContext } from "../session/context"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayToolActivityRuntime } from "./tool-activity"

test("GatewayToolActivityRuntime updates tool sections in call order without duplicating repeated updates", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const snapshots: unknown[] = []

        const runtime = new GatewayToolActivityRuntime(
            {
                session: {
                    async get(input) {
                        return { id: input.sessionID }
                    },
                },
            },
            "/workspace",
            sessions,
            createLogger(),
            {
                enabled: true,
                botToken: "token",
                botTokenEnv: null,
                pollTimeoutSeconds: 25,
                allowedChats: ["42"],
                allowedUsers: [],
                allowedBotUsers: [],
                ux: {
                    toolCallView: "toggle",
                },
            },
        )

        const execution = runtime.beginExecution(
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            async (sections) => {
                snapshots.push(sections)
            },
        )

        execution?.trackSession("session-1")
        runtime.handleEvent(createToolUpdatedEvent("session-1", "call-1", "bash", "running", { cmd: "pwd" }))
        await Bun.sleep(0)
        runtime.handleEvent(
            createToolUpdatedEvent("session-1", "call-1", "bash", "completed", { cmd: "pwd" }, "/workspace"),
        )
        await Bun.sleep(0)

        expect(snapshots).toEqual([
            [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "running",
                    title: null,
                    inputText: '{\n  "cmd": "pwd"\n}',
                    outputText: null,
                    errorText: null,
                },
            ],
            [
                {
                    callId: "call-1",
                    toolName: "bash",
                    status: "completed",
                    title: "bash finished",
                    inputText: '{\n  "cmd": "pwd"\n}',
                    outputText: "/workspace",
                    errorText: null,
                },
            ],
        ])
    } finally {
        db.close()
    }
})

test("GatewayToolActivityRuntime resolves descendant sessions back to the tracked execution context", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const snapshots: unknown[] = []

        const runtime = new GatewayToolActivityRuntime(
            {
                session: {
                    async get(input) {
                        if (input.sessionID === "child-session") {
                            return {
                                id: "child-session",
                                parentID: "session-1",
                            }
                        }

                        return { id: input.sessionID }
                    },
                },
            },
            "/workspace",
            sessions,
            createLogger(),
            {
                enabled: true,
                botToken: "token",
                botTokenEnv: null,
                pollTimeoutSeconds: 25,
                allowedChats: ["42"],
                allowedUsers: [],
                allowedBotUsers: [],
                ux: {
                    toolCallView: "toggle",
                },
            },
        )

        const execution = runtime.beginExecution(
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            async (sections) => {
                snapshots.push(sections)
            },
        )

        execution?.trackSession("session-1")
        runtime.handleEvent(
            createToolUpdatedEvent(
                "child-session",
                "call-1",
                "glob",
                "error",
                { pattern: "*" },
                undefined,
                "permission denied",
            ),
        )
        await Bun.sleep(0)

        expect(snapshots).toEqual([
            [
                {
                    callId: "call-1",
                    toolName: "glob",
                    status: "error",
                    title: null,
                    inputText: '{\n  "pattern": "*"\n}',
                    outputText: null,
                    errorText: "permission denied",
                },
            ],
        ])
    } finally {
        db.close()
    }
})

test("GatewayToolActivityRuntime exposes pending tool raw input before completion", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const snapshots: unknown[] = []

        const runtime = new GatewayToolActivityRuntime(
            {
                session: {
                    async get(input) {
                        return { id: input.sessionID }
                    },
                },
            },
            "/workspace",
            sessions,
            createLogger(),
            {
                enabled: true,
                botToken: "token",
                botTokenEnv: null,
                pollTimeoutSeconds: 25,
                allowedChats: ["42"],
                allowedUsers: [],
                allowedBotUsers: [],
                ux: {
                    toolCallView: "toggle",
                },
            },
        )

        const execution = runtime.beginExecution(
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            async (sections) => {
                snapshots.push(sections)
            },
        )

        execution?.trackSession("session-1")
        runtime.handleEvent({
            type: "message.part.updated",
            properties: {
                part: {
                    id: "part-call-1",
                    sessionID: "session-1",
                    messageID: "msg-call-1",
                    type: "tool",
                    callID: "call-1",
                    tool: "glob",
                    state: {
                        status: "pending",
                        raw: "glob **/*.rs",
                    },
                },
            },
        })
        await Bun.sleep(0)

        expect(snapshots).toEqual([
            [
                {
                    callId: "call-1",
                    toolName: "glob",
                    status: "pending",
                    title: null,
                    inputText: "glob **/*.rs",
                    outputText: null,
                    errorText: null,
                },
            ],
        ])
    } finally {
        db.close()
    }
})

function createToolUpdatedEvent(
    sessionID: string,
    callID: string,
    tool: string,
    status: "running" | "completed" | "error",
    input: Record<string, unknown>,
    output?: string,
    error?: string,
) {
    return {
        type: "message.part.updated" as const,
        properties: {
            part: {
                id: `part-${callID}`,
                sessionID,
                messageID: `msg-${callID}`,
                type: "tool" as const,
                callID,
                tool,
                state:
                    status === "running"
                        ? {
                              status: "running" as const,
                              input,
                              time: { start: 1 },
                          }
                        : status === "completed"
                          ? {
                                status: "completed" as const,
                                input,
                                title: `${tool} finished`,
                                output: output ?? "",
                                metadata: {},
                                time: { start: 1, end: 2 },
                            }
                          : {
                                status: "error" as const,
                                input,
                                error: error ?? "error",
                                time: { start: 1, end: 2 },
                            },
            },
        },
    }
}

function createLogger() {
    return {
        log() {},
    }
}
