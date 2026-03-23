import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import { GatewayMailboxRouter } from "../mailbox/router"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewaySessionContext } from "./context"
import { ChannelSessionSwitcher } from "./switcher"

test("ChannelSessionSwitcher switches the routed conversation key to a fresh session", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        const target = {
            channel: "telegram",
            target: "42",
            topic: null,
        } as const

        store.putSessionBinding("shared:alpha", "ses_old", 1)
        sessions.replaceReplyTargets("ses_old", "shared:alpha", [target], 1)
        store.replacePendingQuestion({
            requestId: "question-1",
            sessionId: "ses_old",
            questions: [
                {
                    header: "Confirm",
                    question: "Continue?",
                    options: [
                        {
                            label: "Yes",
                            description: "Continue",
                        },
                    ],
                    multiple: false,
                    custom: false,
                },
            ],
            targets: [
                {
                    deliveryTarget: target,
                    telegramMessageId: 77,
                },
            ],
            recordedAtMs: 2,
        })

        const createdTitles: string[] = []
        const switcher = new ChannelSessionSwitcher(
            store,
            sessions,
            new GatewayMailboxRouter([
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                    mailboxKey: "shared:alpha",
                },
            ]),
            {
                conversationKeyForDeliveryTarget() {
                    return "telegram:42"
                },
            },
            {
                async createFreshSession(title) {
                    createdTitles.push(title)
                    return "ses_new"
                },
            },
            true,
        )

        expect(await switcher.createAndSwitchSession(target, null)).toEqual({
            channel: "telegram",
            target: "42",
            topic: null,
            conversationKey: "shared:alpha",
            previousSessionId: "ses_old",
            newSessionId: "ses_new",
            effectiveOn: "next_message",
        })
        expect(createdTitles).toEqual(["Gateway telegram:42"])
        expect(store.getSessionBinding("shared:alpha")).toBe("ses_new")
        expect(store.getDefaultSessionReplyTarget("ses_old")).toBeNull()
        expect(store.getDefaultSessionReplyTarget("ses_new")).toEqual(target)
        expect(store.getPendingQuestionForTarget(target)).toBeNull()
    } finally {
        db.close()
    }
})
