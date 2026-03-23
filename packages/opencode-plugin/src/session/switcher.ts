import type { BindingDeliveryTarget, GatewayContract } from "../binding"
import type { GatewayMailboxRouter } from "../mailbox/router"
import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { SqliteStore } from "../store/sqlite"
import type { GatewaySessionContext } from "./context"
import { resolveConversationKeyForTarget } from "./conversation-key"

export type ChannelSessionSwitchResult = {
    channel: string
    target: string
    topic: string | null
    conversationKey: string
    previousSessionId: string | null
    newSessionId: string
    effectiveOn: "next_message"
}

export class ChannelSessionSwitcher {
    constructor(
        private readonly store: SqliteStore,
        private readonly sessions: GatewaySessionContext,
        private readonly router: GatewayMailboxRouter,
        private readonly contract: Pick<GatewayContract, "conversationKeyForDeliveryTarget">,
        private readonly opencode: Pick<OpencodeSdkAdapter, "createFreshSession">,
        private readonly telegramEnabled: boolean,
    ) {}

    hasEnabledChannel(): boolean {
        return this.telegramEnabled
    }

    async createAndSwitchSession(
        target: BindingDeliveryTarget,
        title: string | null,
    ): Promise<ChannelSessionSwitchResult> {
        assertSupportedTarget(target, this.telegramEnabled)

        const conversationKey = resolveConversationKeyForTarget(target, this.router, this.contract)
        const previousSessionId = this.store.getSessionBinding(conversationKey)
        const recordedAtMs = Date.now()
        const newSessionId = await this.opencode.createFreshSession(defaultSessionTitle(title, target))

        if (previousSessionId !== null) {
            this.store.deletePendingQuestionsForSession(previousSessionId)
            this.store.clearSessionReplyTargets(previousSessionId)
        }

        this.store.putSessionBinding(conversationKey, newSessionId, recordedAtMs)
        this.sessions.replaceReplyTargets(newSessionId, conversationKey, [target], recordedAtMs)

        return {
            channel: target.channel,
            target: target.target,
            topic: target.topic,
            conversationKey,
            previousSessionId,
            newSessionId,
            effectiveOn: "next_message",
        }
    }
}

function assertSupportedTarget(target: BindingDeliveryTarget, telegramEnabled: boolean): void {
    if (target.channel !== "telegram") {
        throw new Error(`unsupported channel for session switching: ${target.channel}`)
    }

    if (!telegramEnabled) {
        throw new Error("telegram is not enabled")
    }
}

function defaultSessionTitle(title: string | null, target: BindingDeliveryTarget): string {
    const normalized = title?.trim() ?? ""
    if (normalized.length > 0) {
        return normalized
    }

    return target.topic === null
        ? `Gateway ${target.channel}:${target.target}`
        : `Gateway ${target.channel}:${target.target} topic ${target.topic}`
}
