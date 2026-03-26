import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewayInteractionRequest } from "./types"

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

type PermissionAskedEvent = {
    type: "permission.asked"
    properties: {
        id: string
        sessionID: string
        permission: string
        patterns: string[]
        metadata: Record<string, unknown>
        always: string[]
        tool?: {
            messageID: string
            callID: string
        }
    }
}

type InteractionResolvedEvent =
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
    | {
          type: "permission.replied"
          properties: {
              requestID: string
          }
      }

export type GatewayInteractionEvent =
    | {
          kind: "asked"
          request: GatewayInteractionRequest
      }
    | {
          kind: "resolved"
          requestId: string
      }

export function normalizeInteractionEvent(event: OpencodeRuntimeEvent): GatewayInteractionEvent | null {
    if (isQuestionAskedEvent(event)) {
        return {
            kind: "asked",
            request: {
                kind: "question",
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

    if (isPermissionAskedEvent(event)) {
        return {
            kind: "asked",
            request: {
                kind: "permission",
                requestId: event.properties.id,
                sessionId: event.properties.sessionID,
                permission: event.properties.permission,
                patterns: [...event.properties.patterns],
                metadata: event.properties.metadata,
                always: [...event.properties.always],
                tool:
                    event.properties.tool === undefined
                        ? null
                        : {
                              messageId: event.properties.tool.messageID,
                              callId: event.properties.tool.callID,
                          },
            },
        }
    }

    if (isInteractionResolvedEvent(event)) {
        return {
            kind: "resolved",
            requestId: event.properties.requestID,
        }
    }

    return null
}

function isQuestionAskedEvent(event: OpencodeRuntimeEvent): event is QuestionAskedEvent {
    if (event.type !== "question.asked" || !isRecord(event.properties)) {
        return false
    }

    return (
        typeof event.properties.id === "string" &&
        typeof event.properties.sessionID === "string" &&
        Array.isArray(event.properties.questions)
    )
}

function isPermissionAskedEvent(event: OpencodeRuntimeEvent): event is PermissionAskedEvent {
    if (event.type !== "permission.asked" || !isRecord(event.properties)) {
        return false
    }

    const properties = event.properties as Record<string, unknown>
    return (
        typeof properties.id === "string" &&
        typeof properties.sessionID === "string" &&
        typeof properties.permission === "string" &&
        isStringArray(properties.patterns) &&
        isRecord(properties.metadata) &&
        isStringArray(properties.always) &&
        (properties.tool === undefined || isPermissionTool(properties.tool))
    )
}

function isPermissionTool(value: unknown): value is NonNullable<PermissionAskedEvent["properties"]["tool"]> {
    return isRecord(value) && typeof value.messageID === "string" && typeof value.callID === "string"
}

function isInteractionResolvedEvent(event: OpencodeRuntimeEvent): event is InteractionResolvedEvent {
    if (
        (event.type !== "question.replied" &&
            event.type !== "question.rejected" &&
            event.type !== "permission.replied") ||
        !isRecord(event.properties)
    ) {
        return false
    }

    return typeof event.properties.requestID === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}
