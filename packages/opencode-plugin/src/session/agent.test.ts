import { expect, test } from "bun:test"

import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewaySessionAgentRuntime } from "./agent"
import { GatewaySessionContext } from "./context"

test("GatewaySessionAgentRuntime resolves the default visible primary agent for a bound gateway session", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        store.putSessionBinding("telegram:42", "session-1", 1)

        const runtime = new GatewaySessionAgentRuntime(
            {
                async listAgents() {
                    return [
                        { name: "build", mode: "primary" as const },
                        { name: "plan", mode: "primary" as const },
                        { name: "general", mode: "subagent" as const },
                    ]
                },
            },
            sessions,
            store,
        )

        await expect(runtime.getStatusForSession("session-1")).resolves.toEqual({
            conversationKey: "telegram:42",
            effectivePrimaryAgent: "build",
            source: "default_primary_agent",
            routeOverrideAgent: null,
            routeOverrideValid: false,
            defaultPrimaryAgent: "build",
            availablePrimaryAgents: ["build", "plan"],
        })
    } finally {
        db.close()
    }
})

test("GatewaySessionAgentRuntime persists a route override and reuses it across sessions on the same route", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        sessions.replaceReplyTargets(
            "session-route",
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

        const runtime = new GatewaySessionAgentRuntime(
            {
                async listAgents() {
                    return [
                        { name: "build", mode: "primary" as const },
                        { name: "plan", mode: "all" as const },
                        { name: "summary", mode: "primary" as const, hidden: true },
                    ]
                },
            },
            sessions,
            store,
        )

        await expect(runtime.switchAgentForSession("session-route", "plan")).resolves.toMatchObject({
            conversationKey: "telegram:42",
            previousEffectivePrimaryAgent: "build",
            previousRouteOverrideAgent: null,
            effectivePrimaryAgent: "plan",
            source: "route_override",
            routeOverrideAgent: "plan",
            routeOverrideValid: true,
            defaultPrimaryAgent: "build",
            availablePrimaryAgents: ["build", "plan"],
            effectiveOn: "next_message",
        })

        store.putSessionBinding("telegram:42", "session-new", 2)

        await expect(runtime.getStatusForSession("session-new")).resolves.toMatchObject({
            conversationKey: "telegram:42",
            effectivePrimaryAgent: "plan",
            source: "route_override",
            routeOverrideAgent: "plan",
            routeOverrideValid: true,
        })
    } finally {
        db.close()
    }
})

test("GatewaySessionAgentRuntime falls back to the default primary agent when a stored override is stale", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        store.putSessionBinding("telegram:42", "session-1", 1)
        store.putConversationAgentOverride("telegram:42", "ghost", 2)

        const runtime = new GatewaySessionAgentRuntime(
            {
                async listAgents() {
                    return [
                        { name: "build", mode: "primary" as const },
                        { name: "plan", mode: "primary" as const },
                    ]
                },
            },
            sessions,
            store,
        )

        await expect(runtime.getStatusForSession("session-1")).resolves.toEqual({
            conversationKey: "telegram:42",
            effectivePrimaryAgent: "build",
            source: "default_primary_agent",
            routeOverrideAgent: "ghost",
            routeOverrideValid: false,
            defaultPrimaryAgent: "build",
            availablePrimaryAgents: ["build", "plan"],
        })
    } finally {
        db.close()
    }
})

test("GatewaySessionAgentRuntime rejects non-primary targets when switching agents", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        store.putSessionBinding("telegram:42", "session-1", 1)

        const runtime = new GatewaySessionAgentRuntime(
            {
                async listAgents() {
                    return [
                        { name: "build", mode: "primary" as const },
                        { name: "general", mode: "subagent" as const },
                    ]
                },
            },
            sessions,
            store,
        )

        await expect(runtime.switchAgentForSession("session-1", "general")).rejects.toThrow(
            'agent "general" is not a selectable primary agent; available_primary_agents=build',
        )
    } finally {
        db.close()
    }
})
