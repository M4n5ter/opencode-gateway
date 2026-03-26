export type BindingExecutionPartKind = "text" | "reasoning"

export type BindingExecutionObservation =
    | {
          kind: "messageUpdated"
          sessionId: string
          messageId: string
          role: string
          parentId: string | null
      }
    | {
          kind: "textPartUpdated"
          sessionId: string
          messageId: string
          partId: string
          partKind: BindingExecutionPartKind
          text: string | null
          delta: string | null
          ignored: boolean
      }
    | {
          kind: "textPartDelta"
          messageId: string
          partId: string
          delta: string
      }

export type BindingProgressivePreview = {
    processText: string | null
    reasoningText: string | null
    answerText: string | null
}

export type BindingProgressiveDirective =
    | {
          kind: "noop"
      }
    | {
          kind: "preview"
          processText: string | null
          reasoningText: string | null
          answerText: string | null
      }
    | {
          kind: "final"
          text: string
      }
