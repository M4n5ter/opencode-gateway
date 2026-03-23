export type GatewayStatusSnapshot = {
    runtimeMode: string
    supportsTelegram: boolean
    supportsCron: boolean
    hasWebUi: boolean
}

export type BindingCronJobSpec = {
    id: string
    schedule: string
    prompt: string
    deliveryChannel: string | null
    deliveryTarget: string | null
    deliveryTopic: string | null
}

export type BindingRuntimeReport = {
    conversationKey: string
    responseText: string
    delivered: boolean
    recordedAtMs: bigint
}

export type BindingHostAck = {
    errorMessage: string | null
}

export type BindingDeliveryTarget = {
    channel: string
    target: string
    topic: string | null
}

export type BindingInboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    sender: string
    body: string
    mailboxKey?: string | null
}

export type BindingPreparedExecution = {
    conversationKey: string
    prompt: string
    replyTarget: BindingDeliveryTarget | null
}

export type BindingOutboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    body: string
}

export type BindingTransportHost = {
    sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck>
}

export type BindingLoggerHost = {
    log(level: string, message: string): void
}

export type GatewayContract = {
    gatewayStatus(): GatewayStatusSnapshot
    nextCronRunAt(job: BindingCronJobSpec, afterMs: number, timeZone: string): number
    normalizeCronTimeZone(timeZone: string): string
}
