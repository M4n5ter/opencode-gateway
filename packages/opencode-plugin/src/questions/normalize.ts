import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewayQuestionRequest } from "./types"

type QuestionAskedEvent = {
    type: "question.asked"
    properties: {
        id: string
        sessionID: string
        questions: Array<{
            header: string
            question: string
            options: Array<{
                label: string
                description: string
            }>
            multiple?: boolean
            custom?: boolean
        }>
    }
}

type QuestionResolvedEvent =
    | {
          type: "question.replied"
          properties: {
              requestID: string
          }
      }
    | {
          type: "question.rejected"
          properties: {
              requestID: string
          }
      }

export type GatewayQuestionEvent =
    | {
          kind: "asked"
          request: GatewayQuestionRequest
      }
    | {
          kind: "resolved"
          requestId: string
      }

export function normalizeQuestionEvent(event: OpencodeRuntimeEvent): GatewayQuestionEvent | null {
    if (isQuestionAskedEvent(event)) {
        return {
            kind: "asked",
            request: {
                requestId: event.properties.id,
                sessionId: event.properties.sessionID,
                questions: event.properties.questions.map((question) => ({
                    header: question.header,
                    question: question.question,
                    options: question.options.map((option) => ({
                        label: option.label,
                        description: option.description,
                    })),
                    multiple: question.multiple === true,
                    custom: question.custom !== false,
                })),
            },
        }
    }

    if (isQuestionResolvedEvent(event)) {
        return {
            kind: "resolved",
            requestId: event.properties.requestID,
        }
    }

    return null
}

function isQuestionAskedEvent(event: OpencodeRuntimeEvent): event is QuestionAskedEvent {
    if (event.type !== "question.asked" || typeof event.properties !== "object" || event.properties === null) {
        return false
    }

    const properties = event.properties as Record<string, unknown>
    return (
        typeof properties.id === "string" &&
        typeof properties.sessionID === "string" &&
        Array.isArray(properties.questions)
    )
}

function isQuestionResolvedEvent(event: OpencodeRuntimeEvent): event is QuestionResolvedEvent {
    if (
        (event.type !== "question.replied" && event.type !== "question.rejected") ||
        typeof event.properties !== "object" ||
        event.properties === null
    ) {
        return false
    }

    return typeof (event.properties as Record<string, unknown>).requestID === "string"
}
