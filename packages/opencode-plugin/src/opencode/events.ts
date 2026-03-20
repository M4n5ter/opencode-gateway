type TextSnapshotHandler = (text: string) => Promise<void> | void

type TrackedTextPart = {
    text: string
    order: number
}

type PendingPrompt = {
    onSnapshot: TextSnapshotHandler
    textParts: Map<string, TrackedTextPart>
    nextOrder: number
    lastSnapshot: string
    assistantMessageId: string | null
}

type MessageInfo =
    | {
          sessionID: string
          id: string
          role: "assistant"
          parentID: string
      }
    | {
          sessionID: string
          id: string
          role: string
          parentID?: string
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
    text?: string
    ignored?: boolean
}

type MessagePartUpdatedEvent = {
    type: "message.part.updated"
    properties: {
        part: MessagePart
    }
}

export type OpencodeRuntimeEvent =
    | MessageUpdatedEvent
    | MessagePartUpdatedEvent
    | {
          type: string
          properties?: unknown
      }

export class OpencodeEventHub {
    private readonly pendingPrompts = new Map<string, PendingPrompt>()

    registerPrompt(sessionId: string, onSnapshot: TextSnapshotHandler): { dispose(): void } {
        this.pendingPrompts.set(sessionId, {
            onSnapshot,
            textParts: new Map(),
            nextOrder: 0,
            lastSnapshot: "",
            assistantMessageId: null,
        })

        return {
            dispose: () => {
                this.pendingPrompts.delete(sessionId)
            },
        }
    }

    async handleEvent(event: OpencodeRuntimeEvent): Promise<void> {
        if (isMessageUpdatedEvent(event)) {
            this.attachAssistantMessage(event.properties.info)
            return
        }

        if (!isMessagePartUpdatedEvent(event)) {
            return
        }

        const part = event.properties.part
        if (part.type !== "text" || part.ignored === true) {
            return
        }

        const prompt = this.findPrompt(part.sessionID, part.messageID)
        if (!prompt) {
            return
        }

        const nextText = typeof part.text === "string" ? part.text : ""
        const trackedPart = prompt.textParts.get(part.id)
        if (trackedPart) {
            trackedPart.text = nextText
        } else {
            prompt.textParts.set(part.id, {
                text: nextText,
                order: prompt.nextOrder,
            })
            prompt.nextOrder += 1
        }

        const snapshot = renderSnapshot(prompt.textParts)
        if (snapshot === prompt.lastSnapshot) {
            return
        }

        prompt.lastSnapshot = snapshot

        try {
            await prompt.onSnapshot(snapshot)
        } catch {
            // Preview delivery must not break the final response path.
        }
    }

    private attachAssistantMessage(info: MessageInfo): void {
        if (info.role !== "assistant" || typeof info.parentID !== "string") {
            return
        }

        const prompt = this.pendingPrompts.get(info.sessionID)
        if (!prompt) {
            return
        }

        prompt.assistantMessageId = info.id
    }

    private findPrompt(sessionId: string, messageId: string): PendingPrompt | null {
        const prompt = this.pendingPrompts.get(sessionId)
        if (prompt?.assistantMessageId === messageId) {
            return prompt
        }

        return null
    }
}

function isMessageUpdatedEvent(event: OpencodeRuntimeEvent): event is MessageUpdatedEvent {
    return event.type === "message.updated" && typeof event.properties === "object" && event.properties !== null
}

function isMessagePartUpdatedEvent(event: OpencodeRuntimeEvent): event is MessagePartUpdatedEvent {
    return event.type === "message.part.updated" && typeof event.properties === "object" && event.properties !== null
}

function renderSnapshot(textParts: Map<string, TrackedTextPart>): string {
    return [...textParts.values()]
        .sort((left, right) => left.order - right.order)
        .map((part) => part.text.trim())
        .filter((text) => text.length > 0)
        .join("\n")
}
