import type { BindingDeliveryTarget } from "../binding"
import type { SqliteStore } from "../store/sqlite"

export class GatewaySessionContext {
    constructor(private readonly store: SqliteStore) {}

    replaceReplyTargets(
        sessionId: string,
        conversationKey: string,
        targets: BindingDeliveryTarget[],
        recordedAtMs: number,
    ): void {
        this.store.replaceSessionReplyTargets({
            sessionId,
            conversationKey,
            targets,
            recordedAtMs,
        })
    }

    listReplyTargets(sessionId: string): BindingDeliveryTarget[] {
        return this.store.listSessionReplyTargets(sessionId)
    }

    getDefaultReplyTarget(sessionId: string): BindingDeliveryTarget | null {
        return this.store.getDefaultSessionReplyTarget(sessionId)
    }

    getConversationKey(sessionId: string): string | null {
        return this.store.getConversationKeyForSession(sessionId)
    }

    isGatewaySession(sessionId: string): boolean {
        return this.store.hasGatewaySession(sessionId)
    }
}
