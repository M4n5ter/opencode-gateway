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
    requestId: string
    sessionId: string
    questions: GatewayQuestionInfo[]
}

export type PendingQuestionRecord = GatewayQuestionRequest & {
    deliveryTarget: BindingDeliveryTarget
    telegramMessageId: number | null
    createdAtMs: number
}
