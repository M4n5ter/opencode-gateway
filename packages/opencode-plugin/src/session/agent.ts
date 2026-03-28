import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { SqliteStore } from "../store/sqlite"
import type { GatewaySessionContext } from "./context"

type GatewayAgentRecord = {
    name: string
    mode: string
    hidden?: boolean
}

type GatewayPrimaryAgentCatalog = {
    defaultPrimaryAgent: string
    availablePrimaryAgents: string[]
}

export type GatewayConversationAgentStatus = {
    conversationKey: string
    effectivePrimaryAgent: string
    source: "route_override" | "default_primary_agent"
    routeOverrideAgent: string | null
    routeOverrideValid: boolean
    defaultPrimaryAgent: string
    availablePrimaryAgents: string[]
}

export type GatewayConversationAgentSwitchResult = GatewayConversationAgentStatus & {
    previousEffectivePrimaryAgent: string
    previousRouteOverrideAgent: string | null
    effectiveOn: "next_message"
}

export class GatewaySessionAgentRuntime {
    constructor(
        private readonly opencode: Pick<OpencodeSdkAdapter, "listAgents">,
        private readonly sessions: Pick<GatewaySessionContext, "getConversationKey" | "isGatewaySession">,
        private readonly store: Pick<SqliteStore, "getConversationAgentOverride" | "putConversationAgentOverride">,
    ) {}

    async getStatusForSession(sessionId: string): Promise<GatewayConversationAgentStatus> {
        return await this.getStatusForConversation(this.requireConversationKey(sessionId))
    }

    async switchAgentForSession(sessionId: string, agent: string): Promise<GatewayConversationAgentSwitchResult> {
        const conversationKey = this.requireConversationKey(sessionId)
        const previous = await this.getStatusForConversation(conversationKey)
        const nextAgent = normalizeAgentName(agent)
        const catalog = await this.loadPrimaryAgentCatalog()

        if (!catalog.availablePrimaryAgents.includes(nextAgent)) {
            const available = formatAgentList(catalog.availablePrimaryAgents)
            throw new Error(
                `agent "${nextAgent}" is not a selectable primary agent; available_primary_agents=${available}`,
            )
        }

        this.store.putConversationAgentOverride(conversationKey, nextAgent, Date.now())

        return {
            ...(await this.getStatusForConversation(conversationKey)),
            previousEffectivePrimaryAgent: previous.effectivePrimaryAgent,
            previousRouteOverrideAgent: previous.routeOverrideAgent,
            effectiveOn: "next_message",
        }
    }

    async resolveEffectivePrimaryAgent(conversationKey: string): Promise<string> {
        return (await this.getStatusForConversation(conversationKey)).effectivePrimaryAgent
    }

    private async getStatusForConversation(conversationKey: string): Promise<GatewayConversationAgentStatus> {
        const routeOverrideAgent = normalizeStoredAgent(this.store.getConversationAgentOverride(conversationKey))
        const catalog = await this.loadPrimaryAgentCatalog()
        const routeOverrideValid =
            routeOverrideAgent !== null && catalog.availablePrimaryAgents.includes(routeOverrideAgent)

        return {
            conversationKey,
            effectivePrimaryAgent: routeOverrideValid ? routeOverrideAgent : catalog.defaultPrimaryAgent,
            source: routeOverrideValid ? "route_override" : "default_primary_agent",
            routeOverrideAgent,
            routeOverrideValid,
            defaultPrimaryAgent: catalog.defaultPrimaryAgent,
            availablePrimaryAgents: catalog.availablePrimaryAgents,
        }
    }

    private requireConversationKey(sessionId: string): string {
        const conversationKey = this.sessions.getConversationKey(sessionId)
        if (conversationKey !== null) {
            return conversationKey
        }

        if (!this.sessions.isGatewaySession(sessionId)) {
            throw new Error("current session is not managed by the gateway")
        }

        throw new Error("current gateway session has no persisted conversation key")
    }

    private async loadPrimaryAgentCatalog(): Promise<GatewayPrimaryAgentCatalog> {
        const seen = new Set<string>()
        const availablePrimaryAgents = (await this.opencode.listAgents())
            .filter(isVisiblePrimaryCapableAgent)
            .map((agent) => normalizeStoredAgent(agent.name))
            .filter((agent): agent is string => agent !== null)
            .filter((agent) => {
                if (seen.has(agent)) {
                    return false
                }

                seen.add(agent)
                return true
            })

        return {
            defaultPrimaryAgent: availablePrimaryAgents[0] ?? "build",
            availablePrimaryAgents,
        }
    }
}

function isVisiblePrimaryCapableAgent(agent: GatewayAgentRecord): boolean {
    return agent.hidden !== true && agent.mode !== "subagent"
}

function normalizeAgentName(agent: string): string {
    const normalized = normalizeStoredAgent(agent)
    if (normalized === null) {
        throw new Error("agent must not be empty")
    }

    return normalized
}

function normalizeStoredAgent(agent: string | null | undefined): string | null {
    if (typeof agent !== "string") {
        return null
    }

    const normalized = agent.trim()
    return normalized.length > 0 ? normalized : null
}

export function formatAgentList(agents: string[]): string {
    return agents.length === 0 ? "none" : agents.join(",")
}
