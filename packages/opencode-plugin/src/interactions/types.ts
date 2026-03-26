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

export type GatewayInteractionRequest = GatewayQuestionRequest | GatewayPermissionRequest

export type PendingInteractionRecord = GatewayInteractionRequest & {
    deliveryTarget: BindingDeliveryTarget
    telegramMessageId: number | null
    createdAtMs: number
}
