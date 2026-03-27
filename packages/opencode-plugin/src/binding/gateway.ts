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

export type BindingExecutionReport = {
    conversationKey: string
    responseText: string
    finalText: string | null
    recordedAtMs: bigint
}

export type BindingDeliveryFailure = {
    deliveryTarget: BindingDeliveryTarget
    errorMessage: string
}

export type BindingDeliveryReport = {
    attemptedTargets: BindingDeliveryTarget[]
    deliveredTargets: BindingDeliveryTarget[]
    failedTargets: BindingDeliveryFailure[]
}

export type BindingDispatchReport = {
    execution: BindingExecutionReport
    delivery: BindingDeliveryReport | null
}

export type BindingDeferredDeliveryStrategy =
    | {
          mode: "send"
      }
    | {
          mode: "edit"
          messageId: number
      }

export type BindingDeferredPreviewContext = {
    processText: string | null
    reasoningText: string | null
    toolSections?: Array<{
        callId: string
        toolName: string
        status: "pending" | "running" | "completed" | "error"
        title: string | null
        inputText: string | null
        outputText: string | null
        errorText: string | null
    }>
}

export type BindingHostAck =
    | {
          kind: "delivered"
      }
    | {
          kind: "retryable_failure"
          errorMessage: string
      }
    | {
          kind: "permanent_edit_failure"
          errorMessage: string
      }

export type BindingDeliveryTarget = {
    channel: string
    target: string
    topic: string | null
}

export type BindingInboundAttachment = {
    kind: "image"
    mimeType: string
    fileName: string | null
    localPath: string
}

export type BindingInboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    sender: string
    text: string | null
    attachments: BindingInboundAttachment[]
    mailboxKey?: string | null
}

export type BindingPromptPart =
    | {
          kind: "text"
          text: string
      }
    | {
          kind: "file"
          mimeType: string
          fileName: string | null
          localPath: string
      }

export type BindingPreparedExecution = {
    conversationKey: string
    promptParts: BindingPromptPart[]
    replyTarget: BindingDeliveryTarget | null
}

export type BindingOutboundMessage = {
    deliveryTarget: BindingDeliveryTarget
    body: string
    previewContext?: BindingDeferredPreviewContext | null
}

export type BindingTransportHost = {
    sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck>
}

export type BindingLogLevel = "debug" | "info" | "warn" | "error"

export type BindingLoggerHost = {
    log(level: BindingLogLevel, message: string): void
}

export type GatewayContract = {
    gatewayStatus(): GatewayStatusSnapshot
    conversationKeyForDeliveryTarget(target: BindingDeliveryTarget): string
    nextCronRunAt(job: BindingCronJobSpec, afterMs: number, timeZone: string): number
    normalizeCronTimeZone(timeZone: string): string
}
