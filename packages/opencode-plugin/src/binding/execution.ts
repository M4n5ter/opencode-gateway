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

export type BindingProgressiveDirective = {
    kind: string
    text: string | null
}
