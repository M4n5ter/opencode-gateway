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

    buildSystemPrompt(sessionId: string): string | null {
        const targets = this.listReplyTargets(sessionId)
        if (targets.length === 0) {
            return null
        }

        if (targets.length === 1) {
            const target = targets[0]
            return [
                "Gateway context:",
                `- Current message source channel: ${target.channel}`,
                `- Current reply target id: ${target.target}`,
                `- Current reply topic: ${target.topic ?? "none"}`,
                "- Unless the user explicitly asks otherwise, channel-aware actions should default to this target.",
                "- If the user asks to start a fresh channel session, use channel_new_session.",
            ].join("\n")
        }

        return [
            "Gateway context:",
            `- This session currently fans out to ${targets.length} reply targets.`,
            ...targets.map(
                (target, index) =>
                    `- Target ${index + 1}: channel=${target.channel}, id=${target.target}, topic=${target.topic ?? "none"}`,
            ),
            "- If a tool needs a single explicit target, do not guess; ask the user or use explicit tool arguments.",
            "- If the user asks to start a fresh channel session for this route, use channel_new_session.",
        ].join("\n")
    }
}
