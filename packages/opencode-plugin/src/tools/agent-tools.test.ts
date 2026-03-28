import { expect, test } from "bun:test"

import { createAgentStatusTool } from "./agent-status"
import { createAgentSwitchTool } from "./agent-switch"

test("agent_status formats the current route-scoped primary agent", async () => {
    const tool = createAgentStatusTool({
        async getStatusForSession(sessionId) {
            expect(sessionId).toBe("session-1")
            return {
                conversationKey: "telegram:42",
                effectivePrimaryAgent: "plan",
                source: "route_override" as const,
                routeOverrideAgent: "plan",
                routeOverrideValid: true,
                defaultPrimaryAgent: "build",
                availablePrimaryAgents: ["build", "plan"],
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

    expect(result).toContain("conversation_key=telegram:42")
    expect(result).toContain("effective_primary_agent=plan")
    expect(result).toContain("route_override_agent=plan")
    expect(result).toContain("available_primary_agents=build,plan")
})

test("agent_switch formats the updated route-scoped primary agent", async () => {
    const tool = createAgentSwitchTool({
        async switchAgentForSession(sessionId, agent) {
            expect(sessionId).toBe("session-1")
            expect(agent).toBe("plan")
            return {
                conversationKey: "telegram:42",
                previousEffectivePrimaryAgent: "build",
                previousRouteOverrideAgent: null,
                effectivePrimaryAgent: "plan",
                source: "route_override" as const,
                routeOverrideAgent: "plan",
                routeOverrideValid: true,
                defaultPrimaryAgent: "build",
                availablePrimaryAgents: ["build", "plan"],
                effectiveOn: "next_message" as const,
            }
        },
    })

    const result = await tool.execute(
        {
            agent: "plan",
        },
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

    expect(result).toContain("previous_effective_primary_agent=build")
    expect(result).toContain("effective_primary_agent=plan")
    expect(result).toContain("effective_on=next_message")
})
