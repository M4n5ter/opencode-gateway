import type { BindingExecutionObservation, BindingProgressiveDirective, ExecutionHandle } from "../binding"

type TextSnapshotHandler = (text: string) => Promise<void> | void

type PendingPrompt = {
    execution: ExecutionHandle
    onPreview: TextSnapshotHandler
    expectedUserMessageId: string
    assistantMessageId: string | null
    resolveAssistantMessageId(messageId: string): void
    assistantMessageIdPromise: Promise<string>
}

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

export class OpencodeEventHub {
    private readonly pendingPrompts = new Map<string, Map<number, PendingPrompt>>()
    private nextPromptId = 0

    registerPrompt(
        sessionId: string,
        execution: ExecutionHandle,
        expectedUserMessageId: string,
        onPreview: TextSnapshotHandler,
    ): {
        dispose(): void
        waitForAssistantMessageId(): Promise<string>
    } {
        const promptId = this.nextPromptId++
        let resolveAssistantMessageId: ((messageId: string) => void) | null = null
        const assistantMessageIdPromise = new Promise<string>((resolve) => {
            resolveAssistantMessageId = resolve
        })
        let prompts = this.pendingPrompts.get(sessionId)
        if (!prompts) {
            prompts = new Map()
            this.pendingPrompts.set(sessionId, prompts)
        }

        prompts.set(promptId, {
            execution,
            onPreview,
            expectedUserMessageId,
            assistantMessageId: null,
            resolveAssistantMessageId: (messageId: string) => {
                resolveAssistantMessageId?.(messageId)
                resolveAssistantMessageId = null
            },
            assistantMessageIdPromise,
        })

        return {
            dispose: () => {
                const current = this.pendingPrompts.get(sessionId)
                if (!current) {
                    return
                }

                current.delete(promptId)
                if (current.size === 0) {
                    this.pendingPrompts.delete(sessionId)
                }
            },
            waitForAssistantMessageId: () => assistantMessageIdPromise,
        }
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        this.trackAssistantBindings(event)
        const observation = normalizeExecutionObservation(event)
        if (observation === null) {
            return
        }

        if ("sessionId" in observation) {
            this.dispatchToSession(observation.sessionId, observation)
            return
        }

        for (const prompts of this.pendingPrompts.values()) {
            for (const prompt of prompts.values()) {
                this.publishDirective(prompt, prompt.execution.observeEvent(observation, monotonicNowMs()))
            }
        }
    }

    private trackAssistantBindings(event: OpencodeRuntimeEvent): void {
        if (!isMessageUpdatedEvent(event)) {
            return
        }

        const info = event.properties.info
        if (info.role !== "assistant" || typeof info.parentID !== "string") {
            return
        }

        const prompts = this.pendingPrompts.get(info.sessionID)
        if (!prompts) {
            return
        }

        for (const prompt of prompts.values()) {
            if (prompt.assistantMessageId !== null || info.parentID !== prompt.expectedUserMessageId) {
                continue
            }

            prompt.assistantMessageId = info.id
            prompt.resolveAssistantMessageId(info.id)
        }
    }

    private dispatchToSession(sessionId: string, observation: BindingExecutionObservation): void {
        const prompts = this.pendingPrompts.get(sessionId)
        if (!prompts) {
            return
        }

        for (const prompt of prompts.values()) {
            this.publishDirective(prompt, prompt.execution.observeEvent(observation, monotonicNowMs()))
        }
    }

    private publishDirective(prompt: PendingPrompt, directive: BindingProgressiveDirective): void {
        if (directive.kind !== "preview" || directive.text === null) {
            return
        }

        void Promise.resolve(prompt.onPreview(directive.text)).catch(() => {
            // Preview delivery must not break the final response path.
        })
    }
}

function normalizeExecutionObservation(event: OpencodeRuntimeEvent): BindingExecutionObservation | null {
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
        if (part.type !== "text") {
            return null
        }

        return {
            kind: "textPartUpdated",
            sessionId: part.sessionID,
            messageId: part.messageID,
            partId: part.id,
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

function monotonicNowMs(): number {
    return Math.trunc(performance.now())
}
