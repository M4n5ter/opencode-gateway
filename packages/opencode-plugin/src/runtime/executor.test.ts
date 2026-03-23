import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost, BindingPreparedExecution } from "../binding"
import { migrateGatewayDatabase } from "../store/migrations"
import type { MailboxEntryRecord } from "../store/sqlite"
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
                async waitUntilSessionIdle(): Promise<void> {},
                async appendPrompt(): Promise<void> {
                    throw new Error("unused")
                },
                async promptSessionWithSnapshots(sessionId: string): Promise<string> {
                    seenSessionIds.push(sessionId)

                    if (sessionId === "ses_stale") {
                        throw new Error("NotFoundError: Session not found: ses_stale")
                    }

                    return "hello back"
                },
            },
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(finalText: string | null): Promise<boolean> {
                                deliveredBodies.push(finalText)
                                return true
                            },
                        },
                    ]
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

test("GatewayExecutor appends earlier mailbox entries and previews the final reply once", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        const appended: Array<{ sessionId: string; prompt: string; messageId: string }> = []
        const previewSnapshots: string[] = []
        const deliveredBodies: Array<string | null> = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async ensureSession(_conversationKey: string, sessionId: string | null): Promise<string> {
                    return sessionId ?? "ses_fresh"
                },
                async waitUntilSessionIdle(): Promise<void> {},
                async appendPrompt(sessionId: string, prompt: string, ids: { messageId: string }): Promise<void> {
                    appended.push({ sessionId, prompt, messageId: ids.messageId })
                },
                async promptSessionWithSnapshots(
                    sessionId: string,
                    prompt: string,
                    ids: { messageId: string },
                    _execution,
                    onSnapshot,
                ): Promise<string> {
                    expect(sessionId).toBe("ses_fresh")
                    expect(prompt).toBe("second")
                    expect(ids.messageId).toBe("msg_gateway_mailbox_2")

                    await onSnapshot?.("preview")
                    return "hello back"
                },
            },
            {
                async openMany() {
                    return [
                        {
                            mode: "progressive" as const,
                            async preview(text: string): Promise<void> {
                                previewSnapshots.push(text)
                            },
                            async finish(finalText: string | null): Promise<boolean> {
                                deliveredBodies.push(finalText)
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.executeMailboxEntries([
            createMailboxEntry(1, "first"),
            createMailboxEntry(2, "second"),
        ])

        expect(appended).toEqual([
            {
                sessionId: "ses_fresh",
                prompt: "first",
                messageId: "msg_gateway_mailbox_1",
            },
        ])
        expect(previewSnapshots).toEqual(["preview"])
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

function createMailboxEntry(id: number, body: string): MailboxEntryRecord {
    return {
        id,
        mailboxKey: "telegram:42",
        sourceKind: "telegram_update",
        externalId: `update:${id}`,
        sender: "telegram:7",
        body,
        replyChannel: "telegram",
        replyTarget: "42",
        replyTopic: null,
        createdAtMs: 1_000 + id,
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
        normalizeCronTimeZone(timeZone: string) {
            return timeZone.trim()
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
            progressive(_prepared: BindingPreparedExecution, _sessionId: string) {
                return {
                    observeEvent() {
                        return {
                            kind: "noop",
                            text: null,
                        }
                    },
                    finish(finalText: string) {
                        return {
                            kind: "final",
                            text: finalText,
                        }
                    },
                }
            },
            oneshot(_prepared: BindingPreparedExecution, _sessionId: string) {
                return {
                    observeEvent() {
                        return {
                            kind: "noop",
                            text: null,
                        }
                    },
                    finish(finalText: string) {
                        return {
                            kind: "final",
                            text: finalText,
                        }
                    },
                }
            },
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
