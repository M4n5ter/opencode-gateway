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
}

export type BindingRuntimeReport = {
    conversationKey: string
    responseText: string
    delivered: boolean
    recordedAtMs: bigint
}

export type BindingPromptRequest = {
    conversationKey: string
    prompt: string
    sessionId: string | null
}

export type BindingPromptResult = {
    sessionId: string
    responseText: string
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
}

export type BindingOutboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    body: string
}

export type BindingStoreHost = {
    getSessionBinding(conversationKey: string): Promise<string | null>
    putSessionBinding(conversationKey: string, sessionId: string, recordedAtMs: bigint): Promise<void>
    recordInboundMessage(message: BindingInboundMessage, recordedAtMs: bigint): Promise<void>
    recordCronDispatch(job: BindingCronJobSpec, recordedAtMs: bigint): Promise<void>
    recordDelivery(message: BindingOutboundMessage, recordedAtMs: bigint): Promise<void>
}

export type BindingOpencodeHost = {
    runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult>
}

export type BindingTransportHost = {
    sendMessage(message: BindingOutboundMessage): Promise<void>
}

export type BindingClockHost = {
    nowUnixMs(): bigint
}

export type BindingLoggerHost = {
    log(level: string, message: string): void
}

export type GatewayBindingHandle = {
    status(): GatewayStatusSnapshot
    dispatchCronJob(job: BindingCronJobSpec): Promise<BindingRuntimeReport>
    dispose?(): void
}

export type GatewayBindingModule = {
    GatewayBinding: {
        new: (
            store: BindingStoreHost,
            opencode: BindingOpencodeHost,
            transport: BindingTransportHost,
            clock: BindingClockHost,
            logger: BindingLoggerHost,
        ) => GatewayBindingHandle
    }
    initialized?: Promise<void>
    default?: () => Promise<void>
}

const GENERATED_NODE_ENTRYPOINT = new URL("../../../dist/wasm/pkg/node.js", import.meta.url)

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
    const module = (await import(GENERATED_NODE_ENTRYPOINT.href)) as GatewayBindingModule

    if (module.initialized) {
        await module.initialized
    } else if (module.default) {
        await module.default()
    }

    return module
}
