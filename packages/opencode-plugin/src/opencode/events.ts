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
    userMessageId: string | null
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

export class OpencodeEventHub {
    private readonly pendingPrompts = new Map<string, PendingPrompt>()

    registerPrompt(sessionId: string, onSnapshot: TextSnapshotHandler): { dispose(): void } {
        this.pendingPrompts.set(sessionId, {
            onSnapshot,
            textParts: new Map(),
            nextOrder: 0,
            lastSnapshot: "",
            userMessageId: null,
            assistantMessageId: null,
        })

        return {
            dispose: () => {
                this.pendingPrompts.delete(sessionId)
            },
        }
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        if (isMessageUpdatedEvent(event)) {
            this.attachAssistantMessage(event.properties.info)
            return
        }

        if (isMessagePartUpdatedEvent(event)) {
            const part = event.properties.part
            if (part.type !== "text" || part.ignored === true) {
                return
            }

            const prompt = this.findPrompt(part.sessionID, part.messageID)
            if (!prompt) {
                return
            }

            const trackedPart = ensureTrackedPart(prompt, part.id, typeof part.text === "string" ? part.text : "")
            if (typeof event.properties.delta === "string" && event.properties.delta.length > 0) {
                trackedPart.text += event.properties.delta
            } else if (typeof part.text === "string") {
                trackedPart.text = part.text
            }

            this.publishSnapshot(prompt)
            return
        }

        if (isMessagePartDeltaEvent(event)) {
            const prompt = this.findPromptByPart(event.properties.messageID, event.properties.partID)
            if (!prompt || event.properties.field !== "text" || event.properties.delta.length === 0) {
                return
            }

            const trackedPart = prompt.textParts.get(event.properties.partID)
            if (!trackedPart) {
                return
            }

            trackedPart.text += event.properties.delta
            this.publishSnapshot(prompt)
        }
    }

    private attachAssistantMessage(info: MessageInfo): void {
        const prompt = this.pendingPrompts.get(info.sessionID)
        if (!prompt) {
            return
        }

        if (info.role === "user") {
            prompt.userMessageId = info.id
            return
        }

        if (info.role !== "assistant" || typeof info.parentID !== "string") {
            return
        }

        if (prompt.userMessageId !== null && info.parentID !== prompt.userMessageId) {
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

    private findPromptByPart(messageId: string, partId: string): PendingPrompt | null {
        for (const prompt of this.pendingPrompts.values()) {
            if (prompt.assistantMessageId !== messageId) {
                continue
            }

            if (prompt.textParts.has(partId)) {
                return prompt
            }
        }

        return null
    }

    private publishSnapshot(prompt: PendingPrompt): void {
        const snapshot = renderSnapshot(prompt.textParts)
        if (snapshot === prompt.lastSnapshot) {
            return
        }

        prompt.lastSnapshot = snapshot

        void Promise.resolve(prompt.onSnapshot(snapshot)).catch(() => {
            // Preview delivery must not break the final response path.
        })
    }
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

function ensureTrackedPart(prompt: PendingPrompt, partId: string, initialText: string): TrackedTextPart {
    const trackedPart = prompt.textParts.get(partId)
    if (trackedPart) {
        return trackedPart
    }

    const nextPart = {
        text: initialText,
        order: prompt.nextOrder,
    }
    prompt.textParts.set(partId, nextPart)
    prompt.nextOrder += 1
    return nextPart
}

function renderSnapshot(textParts: Map<string, TrackedTextPart>): string {
    return [...textParts.values()]
        .sort((left, right) => left.order - right.order)
        .map((part) => part.text.trim())
        .filter((text) => text.length > 0)
        .join("\n")
}
