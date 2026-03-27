import { normalizeExecutionObservation } from "../opencode/event-normalize"
import type { OpencodeRuntimeEvent } from "../opencode/events"

export type ActiveExecutionHandle = {
    id: number
    conversationKey: string
}

export type CompletedActiveExecution = {
    interrupted: boolean
    sessionId: string | null
    promptMessageId: string | null
    assistantMessageId: string | null
}

type ActiveExecutionRecord = {
    conversationKey: string
    sessionId: string | null
    promptMessageId: string | null
    assistantMessageId: string | null
    interruptRequested: boolean
}

export class ActiveExecutionRegistry {
    private nextId = 1
    private readonly byId = new Map<number, ActiveExecutionRecord>()
    private readonly byConversation = new Map<string, number>()
    private readonly bySession = new Map<string, Set<number>>()

    begin(conversationKey: string): ActiveExecutionHandle {
        const existing = this.byConversation.get(conversationKey)
        if (existing !== undefined) {
            throw new Error(`active execution already exists for conversation ${conversationKey}`)
        }

        const id = this.nextId++
        this.byId.set(id, {
            conversationKey,
            sessionId: null,
            promptMessageId: null,
            assistantMessageId: null,
            interruptRequested: false,
        })
        this.byConversation.set(conversationKey, id)
        return { id, conversationKey }
    }

    isActiveConversation(conversationKey: string): boolean {
        return this.byConversation.has(conversationKey)
    }

    updateSession(handle: ActiveExecutionHandle, sessionId: string): void {
        const record = this.requireRecord(handle)
        if (record.sessionId === sessionId) {
            return
        }

        if (record.sessionId !== null) {
            detachSessionBinding(this.bySession, record.sessionId, handle.id)
        }

        record.sessionId = sessionId
        attachSessionBinding(this.bySession, sessionId, handle.id)
    }

    setPromptMessageId(handle: ActiveExecutionHandle, messageId: string): void {
        const record = this.requireRecord(handle)
        record.promptMessageId = messageId
    }

    wasInterrupted(handle: ActiveExecutionHandle): boolean {
        return this.requireRecord(handle).interruptRequested
    }

    async requestInterrupt(
        conversationKey: string,
        interruptSession: (sessionId: string) => Promise<void>,
    ): Promise<boolean> {
        const executionId = this.byConversation.get(conversationKey)
        if (executionId === undefined) {
            return false
        }

        const record = this.byId.get(executionId)
        if (record === undefined) {
            return false
        }

        record.interruptRequested = true
        if (record.sessionId !== null) {
            await interruptSession(record.sessionId)
        }

        return true
    }

    finish(handle: ActiveExecutionHandle): CompletedActiveExecution {
        const record = this.requireRecord(handle)
        this.byId.delete(handle.id)
        this.byConversation.delete(handle.conversationKey)
        if (record.sessionId !== null) {
            detachSessionBinding(this.bySession, record.sessionId, handle.id)
        }

        return {
            interrupted: record.interruptRequested,
            sessionId: record.sessionId,
            promptMessageId: record.promptMessageId,
            assistantMessageId: record.assistantMessageId,
        }
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        const observation = normalizeExecutionObservation(event)
        if (observation === null || observation.kind !== "messageUpdated" || observation.role !== "assistant") {
            return
        }

        const executionIds = observation.sessionId ? this.bySession.get(observation.sessionId) : undefined
        if (executionIds === undefined || executionIds.size === 0) {
            return
        }

        for (const executionId of executionIds) {
            const record = this.byId.get(executionId)
            if (record === undefined || record.promptMessageId === null) {
                continue
            }

            if (observation.parentId === record.promptMessageId) {
                record.assistantMessageId = observation.messageId
            }
        }
    }

    private requireRecord(handle: ActiveExecutionHandle): ActiveExecutionRecord {
        const record = this.byId.get(handle.id)
        if (record === undefined || record.conversationKey !== handle.conversationKey) {
            throw new Error(`unknown active execution handle for conversation ${handle.conversationKey}`)
        }

        return record
    }
}

function attachSessionBinding(bySession: Map<string, Set<number>>, sessionId: string, executionId: number): void {
    const executionIds = bySession.get(sessionId) ?? new Set<number>()
    executionIds.add(executionId)
    bySession.set(sessionId, executionIds)
}

function detachSessionBinding(bySession: Map<string, Set<number>>, sessionId: string, executionId: number): void {
    const executionIds = bySession.get(sessionId)
    if (executionIds === undefined) {
        return
    }

    executionIds.delete(executionId)
    if (executionIds.size === 0) {
        bySession.delete(sessionId)
    }
}
