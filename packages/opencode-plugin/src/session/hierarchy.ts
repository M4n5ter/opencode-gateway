import type { BindingDeliveryTarget, BindingLoggerHost } from "../binding"
import type { GatewaySessionContext } from "./context"

type SessionHierarchyRecord = {
    id: string
    parentID?: string
}

export type GatewaySessionHierarchyClientLike = {
    session: {
        get(
            input: {
                sessionID: string
                directory?: string
            },
            options?: {
                responseStyle?: "data"
                throwOnError?: boolean
            },
        ): Promise<unknown>
    }
}

export class GatewaySessionHierarchyResolver {
    private readonly parentIds = new Map<string, string | null>()

    constructor(
        private readonly client: GatewaySessionHierarchyClientLike,
        private readonly directory: string,
        private readonly sessions: Pick<GatewaySessionContext, "listReplyTargets">,
        private readonly logger: BindingLoggerHost,
    ) {}

    async resolveReplyTargets(sessionId: string): Promise<BindingDeliveryTarget[]> {
        const directTargets = this.sessions.listReplyTargets(sessionId)
        if (directTargets.length > 0) {
            return directTargets
        }

        const ancestorSessionId = await this.findAncestor(sessionId, (candidateSessionId) => {
            return this.sessions.listReplyTargets(candidateSessionId).length > 0
        })
        if (ancestorSessionId === null) {
            return []
        }

        return this.sessions.listReplyTargets(ancestorSessionId)
    }

    async findAncestor(sessionId: string, predicate: (sessionId: string) => boolean): Promise<string | null> {
        const visited = new Set<string>([sessionId])
        let currentSessionId: string | null = sessionId

        while (currentSessionId !== null) {
            const parentSessionId = await this.readParentSessionId(currentSessionId)
            if (parentSessionId === null || visited.has(parentSessionId)) {
                return null
            }

            if (predicate(parentSessionId)) {
                return parentSessionId
            }

            visited.add(parentSessionId)
            currentSessionId = parentSessionId
        }

        return null
    }

    private async readParentSessionId(sessionId: string): Promise<string | null> {
        if (this.parentIds.has(sessionId)) {
            return this.parentIds.get(sessionId) ?? null
        }

        try {
            const session = unwrapData<SessionHierarchyRecord>(
                await this.client.session.get(
                    {
                        sessionID: sessionId,
                        directory: this.directory,
                    },
                    {
                        responseStyle: "data",
                        throwOnError: true,
                    },
                ),
            )
            const parentSessionId = session.parentID ?? null
            this.parentIds.set(sessionId, parentSessionId)
            return parentSessionId
        } catch (error) {
            this.logger.log("warn", `failed to inspect OpenCode session ${sessionId}: ${extractErrorMessage(error)}`)
            this.parentIds.set(sessionId, null)
            return null
        }
    }
}

function unwrapData<T>(value: unknown): T {
    if (typeof value === "object" && value !== null && "data" in value) {
        return value.data as T
    }

    return value as T
}

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return String(error)
}
