import type { BindingExecutionObservation, BindingProgressiveDirective } from "./execution"

export type BindingOpencodePrompt = {
    promptKey: string
    prompt: string
}

export type BindingOpencodeExecutionInput = {
    conversationKey: string
    persistedSessionId: string | null
    mode: "progressive" | "oneshot"
    flushIntervalMs: number
    prompts: BindingOpencodePrompt[]
}

export type BindingOpencodeMessagePart = {
    messageId: string
    partId: string
    type: string
    text: string | null
    ignored: boolean
}

export type BindingOpencodeMessage = {
    messageId: string
    role: string
    parentId: string | null
    parts: BindingOpencodeMessagePart[]
}

export type BindingOpencodeCommand =
    | {
          kind: "lookupSession"
          sessionId: string
      }
    | {
          kind: "createSession"
          title: string
      }
    | {
          kind: "waitUntilIdle"
          sessionId: string
      }
    | {
          kind: "appendPrompt"
          sessionId: string
          messageId: string
          textPartId: string
          prompt: string
      }
    | {
          kind: "sendPromptAsync"
          sessionId: string
          messageId: string
          textPartId: string
          prompt: string
      }
    | {
          kind: "awaitPromptResponse"
          sessionId: string
          messageId: string
      }
    | {
          kind: "readMessage"
          sessionId: string
          messageId: string
      }
    | {
          kind: "listMessages"
          sessionId: string
      }

export type BindingOpencodeCommandResult =
    | {
          kind: "lookupSession"
          sessionId: string
          found: boolean
      }
    | {
          kind: "createSession"
          sessionId: string
      }
    | {
          kind: "waitUntilIdle"
          sessionId: string
      }
    | {
          kind: "appendPrompt"
          sessionId: string
      }
    | {
          kind: "sendPromptAsync"
          sessionId: string
      }
    | {
          kind: "awaitPromptResponse"
          sessionId: string
          messageId: string
          parts: BindingOpencodeMessagePart[]
      }
    | {
          kind: "readMessage"
          sessionId: string
          messageId: string
          parts: BindingOpencodeMessagePart[]
      }
    | {
          kind: "listMessages"
          sessionId: string
          messages: BindingOpencodeMessage[]
      }
    | {
          kind: "error"
          commandKind: string
          sessionId: string | null
          code: "missingSession" | "unknown"
          message: string
      }

export type BindingOpencodeDriverStep =
    | {
          kind: "command"
          command: BindingOpencodeCommand
      }
    | {
          kind: "complete"
          sessionId: string
          responseText: string
          finalText: string | null
      }
    | {
          kind: "failed"
          message: string
      }

export type OpencodeExecutionDriver = {
    start(): BindingOpencodeDriverStep
    resume(result: BindingOpencodeCommandResult): BindingOpencodeDriverStep
    observeEvent(observation: BindingExecutionObservation, nowMs: number): BindingProgressiveDirective
    free?(): void
}
