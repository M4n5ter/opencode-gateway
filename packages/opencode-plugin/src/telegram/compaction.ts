import type { BindingDeliveryTarget, BindingLoggerHost } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewaySessionContext } from "../session/context"
import { type GatewaySessionHierarchyClientLike, GatewaySessionHierarchyResolver } from "../session/hierarchy"
import type { SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import type { TelegramReactionClientLike } from "./client"

type SessionCompactedEvent = {
    type: "session.compacted"
    properties: {
        sessionID: string
    }
}

type CompactionRuntimeClientLike = GatewaySessionHierarchyClientLike

export class GatewayTelegramCompactionRuntime {
    private readonly hierarchy: GatewaySessionHierarchyResolver
    private readonly enabled: boolean
    private readonly emoji: string

    constructor(
        private readonly reactionClient: TelegramReactionClientLike | null,
        hierarchyClient: CompactionRuntimeClientLike,
        directory: string,
        private readonly store: SqliteStore,
        private readonly sessions: Pick<GatewaySessionContext, "listReplyTargets">,
        private readonly logger: BindingLoggerHost,
        telegram: TelegramConfig,
    ) {
        this.hierarchy = new GatewaySessionHierarchyResolver(hierarchyClient, directory, sessions, logger)
        this.enabled = telegram.enabled && this.reactionClient !== null && telegram.ux.compactionReaction
        this.emoji = telegram.enabled ? telegram.ux.compactionReactionEmoji : "🗜️"
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        if (!this.enabled) {
            return
        }

        const compactedSessionId = readCompactedSessionId(event)
        if (compactedSessionId === null) {
            return
        }

        void this.processCompaction(compactedSessionId)
    }

    async registerSurface(sessionId: string, target: BindingDeliveryTarget, messageId: number): Promise<void> {
        if (!this.enabled || target.channel !== "telegram") {
            return
        }

        this.store.upsertTelegramSessionSurface({
            sessionId,
            deliveryTarget: target,
            messageId,
            recordedAtMs: Date.now(),
        })

        await this.applyReactionIfNeeded(sessionId, target)
    }

    private async processCompaction(sessionId: string): Promise<void> {
        const resolvedSessionId = await this.resolveReactionSessionId(sessionId)
        if (resolvedSessionId === null) {
            return
        }

        const recordedAtMs = Date.now()
        this.store.recordTelegramSessionCompaction(resolvedSessionId, recordedAtMs)
        const surfaces = this.store.listTelegramSessionSurfaces(resolvedSessionId)
        for (const surface of surfaces) {
            await this.applyReactionIfNeeded(resolvedSessionId, surface.deliveryTarget)
        }
    }

    private async applyReactionIfNeeded(sessionId: string, target: BindingDeliveryTarget): Promise<void> {
        if (!this.enabled || this.reactionClient === null) {
            return
        }

        const compaction = this.store.getTelegramSessionCompaction(sessionId)
        if (compaction === null) {
            return
        }

        const surface = this.store.getTelegramSessionSurface(sessionId, target)
        if (surface === null || surface.reactionEmoji === this.emoji) {
            return
        }

        try {
            await this.reactionClient.setMessageReaction(target.target, surface.messageId, this.emoji)
            const recordedAtMs = Date.now()
            this.store.recordTelegramSessionSurfaceReactionAttempt({
                sessionId,
                deliveryTarget: target,
                emoji: this.emoji,
                appliedAtMs: recordedAtMs,
                recordedAtMs,
            })
        } catch (error) {
            this.store.recordTelegramSessionSurfaceReactionAttempt({
                sessionId,
                deliveryTarget: target,
                emoji: this.emoji,
                appliedAtMs: null,
                recordedAtMs: Date.now(),
            })
            this.logger.log("debug", `telegram compaction reaction failed: ${formatError(error)}`)
        }
    }

    private async resolveReactionSessionId(sessionId: string): Promise<string | null> {
        if (this.hasTelegramSignal(sessionId)) {
            return sessionId
        }

        return await this.hierarchy.findAncestor(sessionId, (candidateSessionId) => {
            return this.hasTelegramSignal(candidateSessionId)
        })
    }

    private hasTelegramSignal(sessionId: string): boolean {
        if (this.store.hasTelegramSessionSurface(sessionId)) {
            return true
        }

        return this.sessions.listReplyTargets(sessionId).some((target) => target.channel === "telegram")
    }
}

function readCompactedSessionId(event: OpencodeRuntimeEvent): string | null {
    if (!isSessionCompactedEvent(event)) {
        return null
    }

    const sessionId = event.properties.sessionID.trim()
    return sessionId.length === 0 ? null : sessionId
}

function isSessionCompactedEvent(event: OpencodeRuntimeEvent): event is SessionCompactedEvent {
    if (event.type !== "session.compacted" || typeof event.properties !== "object" || event.properties === null) {
        return false
    }

    return "sessionID" in event.properties && typeof event.properties.sessionID === "string"
}
