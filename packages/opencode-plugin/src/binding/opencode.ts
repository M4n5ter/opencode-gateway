import type { BindingExecutionObservation, BindingProgressiveDirective } from "./execution"
import type { BindingPromptPart } from "./gateway"

export type BindingOpencodePrompt = {
    promptKey: string
    parts: BindingPromptPart[]
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
          timeoutMs?: number
      }
    | {
          kind: "appendPrompt"
          sessionId: string
          messageId: string
          agent?: string
          parts: BindingOpencodeCommandPart[]
      }
    | {
          kind: "sendPromptAsync"
          sessionId: string
          messageId: string
          agent?: string
          parts: BindingOpencodeCommandPart[]
      }
    | {
          kind: "awaitPromptResponse"
          sessionId: string
          messageId: string
          progressTimeoutMs?: number
          hardTimeoutMs?: number | null
          settleMs?: number
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
          code: "missingSession" | "timeout" | "unknown"
          message: string
      }

export type BindingOpencodeCommandPart =
    | {
          kind: "text"
          partId: string
          text: string
      }
    | {
          kind: "file"
          partId: string
          mimeType: string
          fileName: string | null
          localPath: string
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
