import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost, BindingPromptRequest, BindingPromptResult } from "../binding"
import { okPromptResult } from "../host/result"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayExecutor } from "./executor"

test("GatewayExecutor clears a stale session binding and retries once", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)

        const seenSessionIds: Array<string | null> = []
        const deliveredBodies: string[] = []
        const executor = new GatewayExecutor(
            store,
            {
                async runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult> {
                    seenSessionIds.push(request.sessionId)

                    if (request.sessionId === "ses_stale") {
                        return {
                            sessionId: null,
                            responseText: "",
                            errorMessage: "NotFoundError: Session not found: ses_stale",
                        }
                    }

                    return okPromptResult("ses_fresh", "hello back")
                },
                async runPromptWithSnapshots(): Promise<never> {
                    throw new Error("unused")
                },
            },
            {
                async open() {
                    return {
                        mode: "oneshot" as const,
                        async preview(): Promise<void> {},
                        async finish(finalText: string): Promise<boolean> {
                            deliveredBodies.push(finalText)
                            return true
                        },
                    }
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(seenSessionIds).toEqual(["ses_stale", null])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
        expect(report.delivered).toBe(true)
    } finally {
        db.close()
    }
})

test("GatewayExecutor retries when progressive execution reports a stale OpenCode session", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)

        const seenSessionIds: Array<string | null> = []
        const previewSnapshots: string[] = []
        const deliveredBodies: string[] = []
        const executor = new GatewayExecutor(
            store,
            {
                async runPrompt(): Promise<BindingPromptResult> {
                    throw new Error("unused")
                },
                async runPromptWithSnapshots(
                    request: BindingPromptRequest,
                ): Promise<{ sessionId: string; responseText: string }> {
                    seenSessionIds.push(request.sessionId)

                    if (request.sessionId === "ses_stale") {
                        const error = new Error("NotFoundError")
                        ;(error as Error & { data: { message: string } }).data = {
                            message: "Session not found: ses_stale",
                        }
                        throw error
                    }

                    return {
                        sessionId: "ses_fresh",
                        responseText: "hello back",
                    }
                },
            },
            {
                async open() {
                    return {
                        mode: "progressive" as const,
                        async preview(text: string): Promise<void> {
                            previewSnapshots.push(text)
                        },
                        async finish(finalText: string): Promise<boolean> {
                            deliveredBodies.push(finalText)
                            return true
                        },
                    }
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(seenSessionIds).toEqual(["ses_stale", null])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(previewSnapshots).toEqual([])
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
        expect(report.delivered).toBe(true)
    } finally {
        db.close()
    }
})

test("GatewayExecutor retries when a parse error wraps a stale OpenCode session error", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)

        const seenSessionIds: Array<string | null> = []
        const deliveredBodies: string[] = []
        const executor = new GatewayExecutor(
            store,
            {
                async runPrompt(): Promise<BindingPromptResult> {
                    throw new Error("unused")
                },
                async runPromptWithSnapshots(
                    request: BindingPromptRequest,
                ): Promise<{ sessionId: string; responseText: string }> {
                    seenSessionIds.push(request.sessionId)

                    if (request.sessionId === "ses_stale") {
                        const inner = new Error("NotFoundError")
                        ;(inner as Error & { data: { message: string } }).data = {
                            message: "Session not found: ses_stale",
                        }

                        const outer = new Error("JSON Parse error: Unexpected EOF")
                        ;(outer as Error & { cause: unknown }).cause = inner
                        throw outer
                    }

                    return {
                        sessionId: "ses_fresh",
                        responseText: "hello back",
                    }
                },
            },
            {
                async open() {
                    return {
                        mode: "progressive" as const,
                        async preview(): Promise<void> {},
                        async finish(finalText: string): Promise<boolean> {
                            deliveredBodies.push(finalText)
                            return true
                        },
                    }
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(seenSessionIds).toEqual(["ses_stale", null])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
        expect(report.delivered).toBe(true)
    } finally {
        db.close()
    }
})

function createMessage(): BindingInboundMessage {
    return {
        sender: "telegram:7",
        body: "hello",
        deliveryTarget: {
            channel: "telegram",
            target: "42",
            topic: null,
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
