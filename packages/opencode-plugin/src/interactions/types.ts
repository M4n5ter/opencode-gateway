import type { BindingDeliveryTarget } from "../binding"

export type GatewayQuestionOption = {
    label: string
    description: string
}

export type GatewayQuestionInfo = {
    header: string
    question: string
    options: GatewayQuestionOption[]
    multiple: boolean
    custom: boolean
}

export type GatewayQuestionRequest = {
    kind: "question"
    requestId: string
    sessionId: string
    questions: GatewayQuestionInfo[]
}

export type GatewayPermissionReply = "once" | "always" | "reject"

export type GatewayPermissionRequest = {
    kind: "permission"
    requestId: string
    sessionId: string
    permission: string
    patterns: string[]
    metadata: Record<string, unknown>
    always: string[]
    tool: {
        messageId: string
        callId: string
    } | null
}

export type GatewayInflightPolicyReply = "queue" | "interrupt"

export type GatewayInflightPolicyRequest = {
    kind: "inflight_policy"
    requestId: string
    mailboxKey: string
}

export type GatewayInteractionRequest = GatewayQuestionRequest | GatewayPermissionRequest | GatewayInflightPolicyRequest

export type GatewayInteractionScope =
    | {
          kind: "session"
          id: string
      }
    | {
          kind: "mailbox"
          id: string
      }

export type PendingInteractionRecord = GatewayInteractionRequest & {
    scope: GatewayInteractionScope
    deliveryTarget: BindingDeliveryTarget
    telegramMessageId: number | null
    createdAtMs: number
}
