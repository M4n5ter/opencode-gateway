import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import { GatewaySessionContext } from "../session/context"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createChannelNewSessionTool } from "./channel-new-session"

test("channel_new_session defaults to the current session reply target", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        sessions.replaceReplyTargets(
            "session-1",
            "telegram:42",
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            1,
        )

        const tool = createChannelNewSessionTool(
            {
                async createAndSwitchSession(target, title) {
                    expect(title).toBeNull()
                    expect(target).toEqual({
                        channel: "telegram",
                        target: "42",
                        topic: null,
                    })

                    return {
                        channel: target.channel,
                        target: target.target,
                        topic: target.topic,
                        conversationKey: "telegram:42",
                        previousSessionId: "ses_old",
                        newSessionId: "ses_new",
                        effectiveOn: "next_message" as const,
                    }
                },
            },
            sessions,
        )

        const result = await tool.execute(
            {},
            {
                sessionID: "session-1",
                messageID: "msg-1",
                agent: "default",
                directory: "/workspace",
                worktree: "/workspace",
                abort: new AbortController().signal,
                metadata() {},
                async ask() {},
            },
        )

        expect(result).toContain("channel=telegram")
        expect(result).toContain("target=42")
        expect(result).toContain("previous_session_id=ses_old")
        expect(result).toContain("new_session_id=ses_new")
        expect(result).toContain("effective_on=next_message")
    } finally {
        db.close()
    }
})
