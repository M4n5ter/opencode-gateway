import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type {
    BindingExecutionObservation,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingPreparedExecution,
    BindingProgressiveDirective,
} from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayExecutor } from "./executor"

test("GatewayExecutor clears a stale session binding and retries once on the oneshot path", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)

        const seenSessionIds: Array<string | null> = []
        const deliveredBodies: Array<string | null> = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async ensureSession(_conversationKey: string, sessionId: string | null): Promise<string> {
                    return sessionId ?? "ses_fresh"
                },
                async promptSession(sessionId: string): Promise<string> {
                    seenSessionIds.push(sessionId)

                    if (sessionId === "ses_stale") {
                        throw new Error("NotFoundError: Session not found: ses_stale")
                    }

                    return "hello back"
                },
                async promptSessionWithSnapshots(): Promise<never> {
                    throw new Error("unused")
                },
            },
            {
                async open() {
                    return {
                        mode: "oneshot" as const,
                        async preview(): Promise<void> {},
                        async finish(finalText: string | null): Promise<boolean> {
                            deliveredBodies.push(finalText)
                            return true
                        },
                    }
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(seenSessionIds).toEqual(["ses_stale", "ses_fresh"])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
        expect(report.delivered).toBe(true)
    } finally {
        db.close()
    }
})

test("GatewayExecutor retries when a wrapped error reports a stale OpenCode session on the progressive path", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)

        const seenSessionIds: Array<string | null> = []
        const previewSnapshots: string[] = []
        const deliveredBodies: Array<string | null> = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async ensureSession(_conversationKey: string, sessionId: string | null): Promise<string> {
                    return sessionId ?? "ses_fresh"
                },
                async promptSession(): Promise<never> {
                    throw new Error("unused")
                },
                async promptSessionWithSnapshots(
                    sessionId: string,
                    _prompt: string,
                    execution: {
                        observeEvent(
                            observation: BindingExecutionObservation,
                            nowMs: number,
                        ): BindingProgressiveDirective
                    },
                    onSnapshot: (text: string) => Promise<void>,
                ): Promise<string> {
                    seenSessionIds.push(sessionId)

                    if (sessionId === "ses_stale") {
                        const inner = new Error("NotFoundError")
                        ;(inner as Error & { data: { message: string } }).data = {
                            message: "Session not found: ses_stale",
                        }

                        const outer = new Error("JSON Parse error: Unexpected EOF")
                        ;(outer as Error & { cause: unknown }).cause = inner
                        throw outer
                    }

                    const preview = execution.observeEvent(
                        {
                            kind: "textPartUpdated",
                            sessionId,
                            messageId: "msg_assistant_1",
                            partId: "part-1",
                            text: null,
                            delta: "hello",
                            ignored: false,
                        },
                        0,
                    )
                    if (preview.kind === "preview" && preview.text !== null) {
                        await onSnapshot(preview.text)
                    }

                    return "hello back"
                },
            },
            {
                async open() {
                    return {
                        mode: "progressive" as const,
                        async preview(text: string): Promise<void> {
                            previewSnapshots.push(text)
                        },
                        async finish(finalText: string | null): Promise<boolean> {
                            deliveredBodies.push(finalText)
                            return true
                        },
                    }
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(seenSessionIds).toEqual(["ses_stale", "ses_fresh"])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(previewSnapshots).toEqual(["hello"])
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

function createModule() {
    return {
        gatewayStatus() {
            return {
                runtimeMode: "contract",
                supportsTelegram: true,
                supportsCron: true,
                hasWebUi: false,
            }
        },
        nextCronRunAt() {
            return 1_735_722_000_000
        },
        prepareInboundExecution(message: BindingInboundMessage): BindingPreparedExecution {
            return {
                conversationKey: `telegram:${message.deliveryTarget.target}`,
                prompt: message.body,
                replyTarget: message.deliveryTarget,
            }
        },
        prepareCronExecution() {
            throw new Error("unused")
        },
        ExecutionHandle: {
            progressive(prepared: BindingPreparedExecution, sessionId: string) {
                return createExecutionHandle(prepared, sessionId)
            },
            oneshot(prepared: BindingPreparedExecution, sessionId: string) {
                return createExecutionHandle(prepared, sessionId)
            },
        },
    }
}

function createExecutionHandle(prepared: BindingPreparedExecution, sessionId: string) {
    let finished = false

    return {
        observeEvent(observation: BindingExecutionObservation): BindingProgressiveDirective {
            if (
                observation.kind === "textPartUpdated" &&
                observation.sessionId === sessionId &&
                observation.delta !== null
            ) {
                return {
                    kind: "preview",
                    text: observation.delta,
                }
            }

            return {
                kind: "noop",
                text: null,
            }
        },
        finish(finalText: string): BindingProgressiveDirective {
            if (finished) {
                return {
                    kind: "noop",
                    text: null,
                }
            }

            finished = true
            return {
                kind: "final",
                text: prepared.replyTarget === null ? finalText : finalText,
            }
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
