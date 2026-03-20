import type { PluginInput } from "@opencode-ai/plugin"

import type { BindingOpencodeHost, BindingPromptRequest, BindingPromptResult } from "../binding"
import type { OpencodeEventHub } from "../opencode/events"
import { streamPromptText } from "../opencode/stream"
import { failedPromptResult, okPromptResult } from "./result"

type OpencodeClient = PluginInput["client"]

type SessionPromptPart = {
    messageID?: string
    type: string
    text?: string
    ignored?: boolean
}

type MaybeWrapped<T> = T | { data: T }

type SessionRecord = {
    id: string
}

type PromptResponse = {
    info?: {
        id: string
    }
    parts: SessionPromptPart[]
}

export type GatewayPromptSnapshotHandler = (text: string) => Promise<void> | void

export type GatewayPromptExecution = {
    sessionId: string
    responseText: string
}

export class GatewayOpencodeHost implements BindingOpencodeHost {
    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
        private readonly events: OpencodeEventHub,
    ) {}

    async runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult> {
        try {
            const result = await this.runPromptData(request)
            return okPromptResult(result.sessionId, result.responseText)
        } catch (error) {
            return failedPromptResult(error)
        }
    }

    async runPromptWithSnapshots(
        request: BindingPromptRequest,
        onSnapshot: GatewayPromptSnapshotHandler,
    ): Promise<GatewayPromptExecution> {
        const sessionId = await this.ensureSession(request.conversationKey, request.sessionId)
        const responseText = await streamPromptText(
            this.client,
            this.directory,
            this.events,
            sessionId,
            request.prompt,
            onSnapshot,
        )

        return {
            sessionId,
            responseText,
        }
    }

    private async runPromptData(request: BindingPromptRequest): Promise<GatewayPromptExecution> {
        const sessionId = await this.ensureSession(request.conversationKey, request.sessionId)
        const response = await this.client.session.prompt({
            path: { id: sessionId },
            query: { directory: this.directory },
            body: {
                parts: [{ type: "text", text: request.prompt }],
            },
            responseStyle: "data",
            throwOnError: true,
        })

        const payload = unwrapData<PromptResponse>(response)

        return {
            sessionId,
            responseText: await this.readFinalResponseText(sessionId, payload),
        }
    }

    private async ensureSession(conversationKey: string, sessionId: string | null): Promise<string> {
        if (sessionId === null) {
            return await this.createSession(conversationKey)
        }

        if (await this.canReusePersistedSession(sessionId)) {
            return sessionId
        }

        return await this.createSession(conversationKey)
    }

    private async createSession(conversationKey: string): Promise<string> {
        const session = await this.client.session.create({
            body: { title: sessionTitle(conversationKey) },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

        return unwrapData<SessionRecord>(session).id
    }

    private async readFinalResponseText(sessionId: string, payload: PromptResponse): Promise<string> {
        const messageId = payload.info?.id
        if (!messageId) {
            return extractAssistantText(payload.parts, null)
        }

        const message = await this.client.session.message({
            path: {
                id: sessionId,
                messageID: messageId,
            },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

        return extractAssistantText(unwrapData<PromptResponse>(message).parts, messageId)
    }

    private async canReusePersistedSession(sessionId: string): Promise<boolean> {
        try {
            await this.client.session.get({
                path: { id: sessionId },
                query: { directory: this.directory },
                responseStyle: "data",
                throwOnError: true,
            })

            return true
        } catch (error) {
            if (isMissingSessionError(error)) {
                return false
            }

            throw error
        }
    }
}

function unwrapData<T>(value: MaybeWrapped<T>): T {
    return typeof value === "object" && value !== null && "data" in value ? value.data : value
}

function extractAssistantText(parts: SessionPromptPart[], messageId: string | null): string {
    return parts
        .filter((part): part is SessionPromptPart & { messageID: string; type: "text"; text: string } => {
            return (messageId === null || part.messageID === messageId) && isVisibleTextPart(part)
        })
        .map((part) => part.text.trim())
        .filter((text) => text.length > 0)
        .join("\n")
}

function isVisibleTextPart(part: SessionPromptPart): part is SessionPromptPart & { type: "text"; text: string } {
    return part.type === "text" && typeof part.text === "string" && part.ignored !== true
}

function sessionTitle(conversationKey: string): string {
    return `Gateway ${conversationKey}`
}

function isMissingSessionError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false
    }

    const name = "name" in error ? error.name : undefined
    const message = "data" in error ? extractDataMessage(error.data) : null
    return name === "NotFoundError" && message?.includes("Session not found:") === true
}

function extractDataMessage(value: unknown): string | null {
    if (typeof value !== "object" || value === null) {
        return null
    }

    const message = (value as { message?: unknown }).message
    return typeof message === "string" ? message : null
}
