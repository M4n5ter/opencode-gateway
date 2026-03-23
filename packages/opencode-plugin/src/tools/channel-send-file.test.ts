import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { GatewaySessionContext } from "../session/context"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createChannelSendFileTool } from "./channel-send-file"

test("channel_send_file defaults to the current session reply target", async () => {
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

        const tool = createChannelSendFileTool(
            {
                async sendFile(target, filePath, _caption) {
                    return {
                        channel: target.channel,
                        target: target.target,
                        topic: target.topic,
                        filePath,
                        mimeType: "text/plain",
                        deliveryKind: "document" as const,
                    }
                },
            },
            sessions,
        )

        const result = await tool.execute(
            {
                file_path: "/tmp/report.txt",
            },
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
        expect(result).toContain("file_path=/tmp/report.txt")
    } finally {
        db.close()
    }
})
