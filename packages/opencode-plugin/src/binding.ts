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

export type BindingPromptRequest = {
    conversationKey: string
    prompt: string
    sessionId: string | null
}

export type BindingHostAck = {
    errorMessage: string | null
}

export type BindingSessionBinding = {
    sessionId: string | null
    errorMessage: string | null
}

export type BindingPromptResult = {
    sessionId: string | null
    responseText: string
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
}

export type BindingOutboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    body: string
}

export type BindingProgressiveDirective = {
    kind: string
    text: string | null
}

export type BindingStoreHost = {
    getSessionBinding(conversationKey: string): Promise<BindingSessionBinding>
    putSessionBinding(conversationKey: string, sessionId: string, recordedAtMs: bigint): Promise<BindingHostAck>
    recordInboundMessage(message: BindingInboundMessage, recordedAtMs: bigint): Promise<BindingHostAck>
    recordCronDispatch(job: BindingCronJobSpec, recordedAtMs: bigint): Promise<BindingHostAck>
    recordDelivery(message: BindingOutboundMessage, recordedAtMs: bigint): Promise<BindingHostAck>
}

export type BindingOpencodeHost = {
    runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult>
}

export type BindingTransportHost = {
    sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck>
}

export type BindingClockHost = {
    nowUnixMs(): bigint
}

export type BindingLoggerHost = {
    log(level: string, message: string): void
}

export type GatewayContract = {
    gatewayStatus(): GatewayStatusSnapshot
    nextCronRunAt(job: BindingCronJobSpec, afterMs: number): number
}

export type ProgressiveTextHandle = {
    observeSnapshot(text: string, nowMs: number): BindingProgressiveDirective
    finish(finalText: string, nowMs: number): BindingProgressiveDirective
    free?(): void
}

export type GatewayBindingModule = GatewayContract & {
    ProgressiveTextHandle: {
        progressive: (flushIntervalMs: number) => ProgressiveTextHandle
        oneshot: (flushIntervalMs: number) => ProgressiveTextHandle
    }
    initSync?: (module?: BufferSource | WebAssembly.Module) => unknown
    default?: (module?: BufferSource | WebAssembly.Module) => Promise<unknown>
}

const GENERATED_NODE_ENTRYPOINT = new URL("../../../dist/wasm/pkg/opencode_gateway_ffi.js", import.meta.url)

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
    return (await import(GENERATED_NODE_ENTRYPOINT.href)) as GatewayBindingModule
}
