import type { BindingExecutionObservation, BindingExecutionPartKind } from "../binding"

type MessageInfo =
    | {
          sessionID: string
          id: string
          role: string
          parentID?: string
      }
    | {
          sessionID: string
          id: string
          role: "assistant"
          parentID: string
      }

type MessageUpdatedEvent = {
    type: "message.updated"
    properties: {
        info: MessageInfo
    }
}

type MessagePart = {
    id: string
    sessionID: string
    messageID: string
    type: string
    text?: string | null
    ignored?: boolean
}

type MessagePartUpdatedEvent = {
    type: "message.part.updated"
    properties: {
        part: MessagePart
        delta?: string
    }
}

type MessagePartDeltaEvent = {
    type: "message.part.delta"
    properties: {
        messageID: string
        partID: string
        field: string
        delta: string
    }
}

export type OpencodeRuntimeEvent =
    | MessageUpdatedEvent
    | MessagePartUpdatedEvent
    | MessagePartDeltaEvent
    | {
          type: string
          properties?: unknown
      }

export function normalizeExecutionObservation(event: OpencodeRuntimeEvent): BindingExecutionObservation | null {
    if (isMessageUpdatedEvent(event)) {
        const info = event.properties.info

        return {
            kind: "messageUpdated",
            sessionId: info.sessionID,
            messageId: info.id,
            role: info.role,
            parentId: typeof info.parentID === "string" ? info.parentID : null,
        }
    }

    if (isMessagePartUpdatedEvent(event)) {
        const part = event.properties.part
        const partKind = toExecutionPartKind(part.type)
        if (partKind === null) {
            return null
        }

        return {
            kind: "textPartUpdated",
            sessionId: part.sessionID,
            messageId: part.messageID,
            partId: part.id,
            partKind,
            text: typeof part.text === "string" ? part.text : null,
            delta: typeof event.properties.delta === "string" ? event.properties.delta : null,
            ignored: part.ignored === true,
        }
    }

    if (isMessagePartDeltaEvent(event)) {
        if (event.properties.field !== "text" || event.properties.delta.length === 0) {
            return null
        }

        return {
            kind: "textPartDelta",
            messageId: event.properties.messageID,
            partId: event.properties.partID,
            delta: event.properties.delta,
        }
    }

    return null
}

function isMessageUpdatedEvent(event: OpencodeRuntimeEvent): event is MessageUpdatedEvent {
    return event.type === "message.updated" && typeof event.properties === "object" && event.properties !== null
}

function isMessagePartUpdatedEvent(event: OpencodeRuntimeEvent): event is MessagePartUpdatedEvent {
    return event.type === "message.part.updated" && typeof event.properties === "object" && event.properties !== null
}

function isMessagePartDeltaEvent(event: OpencodeRuntimeEvent): event is MessagePartDeltaEvent {
    return event.type === "message.part.delta" && typeof event.properties === "object" && event.properties !== null
}

function toExecutionPartKind(value: string): BindingExecutionPartKind | null {
    if (value === "text" || value === "reasoning") {
        return value
    }

    return null
}
