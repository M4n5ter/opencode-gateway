import { expect, test } from "bun:test"

import { createGatewayRestartTool } from "./gateway-restart"

test("gateway_restart formats a scheduled restart request", async () => {
    const tool = createGatewayRestartTool({
        async scheduleRestart() {
            return {
                status: "scheduled" as const,
                behavior: "wait_until_idle" as const,
                scope: "managed_opencode_server" as const,
                effectiveOn: "after_current_request_and_when_idle" as const,
                requestedAtMs: 123,
            }
        },
    })

    const result = await tool.execute(
        {},
        {
            sessionID: "session-1",
            messageID: "msg-1",
            agent: "build",
            directory: "/workspace",
            worktree: "/workspace",
            abort: new AbortController().signal,
            metadata() {},
            async ask() {},
        },
    )

    expect(result).toContain("status=scheduled")
    expect(result).toContain("behavior=wait_until_idle")
    expect(result).toContain("scope=managed_opencode_server")
    expect(result).toContain("restart OpenCode on the user's behalf")
})
