import type { BindingDeliveryTarget } from "../binding"
import type { GatewaySessionContext } from "../session/context"

export function resolveToolDeliveryTarget(
    args: {
        channel?: string
        target?: string
        topic?: string
    },
    sessionId: string | null | undefined,
    sessions: GatewaySessionContext,
): BindingDeliveryTarget {
    const fallback = sessionId ? sessions.getDefaultReplyTarget(sessionId) : null
    const channel = normalizeRequired(args.channel ?? fallback?.channel ?? null, "channel")
    const target = normalizeRequired(args.target ?? fallback?.target ?? null, "target")
    const topic = normalizeOptional(args.topic ?? fallback?.topic ?? null)

    return {
        channel,
        target,
        topic,
    }
}

export function resolveOptionalToolDeliveryTarget(
    args: {
        channel?: string
        target?: string
        topic?: string
    },
    sessionId: string | null | undefined,
    sessions: GatewaySessionContext,
): BindingDeliveryTarget | null {
    if (args.channel === undefined && args.target === undefined && args.topic === undefined) {
        return sessionId ? sessions.getDefaultReplyTarget(sessionId) : null
    }

    return resolveToolDeliveryTarget(args, sessionId, sessions)
}

function normalizeRequired(value: string | null, field: string): string {
    if (value === null) {
        throw new Error(`${field} is required when the current session has no default reply target`)
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function normalizeOptional(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}
