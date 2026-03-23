import type { PluginInput } from "@opencode-ai/plugin"

import type {
    BindingOpencodeCommand,
    BindingOpencodeCommandResult,
    BindingOpencodeMessage,
    BindingOpencodeMessagePart,
} from "../binding"

const SESSION_IDLE_POLL_MS = 250
const PROMPT_RESPONSE_TIMEOUT_MS = 90_000

type OpencodeClient = PluginInput["client"]

type MaybeWrapped<T> = T | { data: T }

type SessionRecord = {
    id: string
}

type SessionPromptPart = {
    id?: string
    messageID?: string
    type: string
    text?: string
    ignored?: boolean
}

type MessageResponse = {
    info?: {
        id: string
        role: string
        parentID?: string
        finish?: string
        error?: unknown
    }
    parts: SessionPromptPart[]
}

type AssistantMessageResponse = MessageResponse & {
    info: NonNullable<MessageResponse["info"]> & {
        role: "assistant"
        parentID: string
    }
}

export class OpencodeSdkAdapter {
    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
    ) {}

    async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
        try {
            switch (command.kind) {
                case "lookupSession":
                    return await this.lookupSession(command.sessionId)
                case "createSession":
                    return await this.createSession(command.title)
                case "waitUntilIdle":
                    return await this.waitUntilIdle(command.sessionId)
                case "appendPrompt":
                    return await this.appendPrompt(command)
                case "sendPromptAsync":
                    return await this.sendPromptAsync(command)
                case "awaitPromptResponse":
                    return await this.awaitPromptResponse(command)
                case "readMessage":
                    return await this.readMessage(command)
                case "listMessages":
                    return await this.listMessages(command)
            }
        } catch (error) {
            return toErrorResult(command, error)
        }
    }

    private async lookupSession(sessionId: string): Promise<BindingOpencodeCommandResult> {
        try {
            await this.client.session.get({
                path: { id: sessionId },
                query: { directory: this.directory },
                responseStyle: "data",
                throwOnError: true,
            })

            return {
                kind: "lookupSession",
                sessionId,
                found: true,
            }
        } catch (error) {
            if (isMissingSessionError(error)) {
                return {
                    kind: "lookupSession",
                    sessionId,
                    found: false,
                }
            }

            throw error
        }
    }

    private async createSession(title: string): Promise<BindingOpencodeCommandResult> {
        const session = await this.client.session.create({
            body: { title },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

        return {
            kind: "createSession",
            sessionId: unwrapData<SessionRecord>(session).id,
        }
    }

    private async waitUntilIdle(sessionId: string): Promise<BindingOpencodeCommandResult> {
        for (;;) {
            const statuses = await this.client.session.status({
                query: { directory: this.directory },
                responseStyle: "data",
                throwOnError: true,
            })
            const current = unwrapData<Record<string, { type?: string }>>(statuses)[sessionId]
            if (!current || current.type === "idle") {
                return {
                    kind: "waitUntilIdle",
                    sessionId,
                }
            }

            await Bun.sleep(SESSION_IDLE_POLL_MS)
        }
    }

    private async appendPrompt(
        command: Extract<BindingOpencodeCommand, { kind: "appendPrompt" }>,
    ): Promise<BindingOpencodeCommandResult> {
        await this.client.session.prompt({
            path: { id: command.sessionId },
            query: { directory: this.directory },
            body: {
                messageID: command.messageId,
                noReply: true,
                parts: [{ id: command.textPartId, type: "text", text: command.prompt }],
            },
            responseStyle: "data",
            throwOnError: true,
        })

        return {
            kind: "appendPrompt",
            sessionId: command.sessionId,
        }
    }

    private async sendPromptAsync(
        command: Extract<BindingOpencodeCommand, { kind: "sendPromptAsync" }>,
    ): Promise<BindingOpencodeCommandResult> {
        await this.client.session.promptAsync({
            path: { id: command.sessionId },
            query: { directory: this.directory },
            body: {
                messageID: command.messageId,
                parts: [{ id: command.textPartId, type: "text", text: command.prompt }],
            },
            throwOnError: true,
        })

        return {
            kind: "sendPromptAsync",
            sessionId: command.sessionId,
        }
    }

    private async awaitPromptResponse(
        command: Extract<BindingOpencodeCommand, { kind: "awaitPromptResponse" }>,
    ): Promise<BindingOpencodeCommandResult> {
        const deadline = Date.now() + PROMPT_RESPONSE_TIMEOUT_MS

        for (;;) {
            const messages = await this.client.session.messages({
                path: { id: command.sessionId },
                query: {
                    directory: this.directory,
                    limit: 64,
                },
                responseStyle: "data",
                throwOnError: true,
            })
            const response = selectAssistantResponse(unwrapData<MessageResponse[]>(messages), command.messageId)

            if (response !== null) {
                return {
                    kind: "awaitPromptResponse",
                    sessionId: command.sessionId,
                    messageId: response.info.id,
                    parts: response.parts.flatMap(toBindingMessagePart),
                }
            }

            if (Date.now() >= deadline) {
                throw new Error(
                    `assistant message for prompt ${command.messageId} is unavailable after prompt completion`,
                )
            }

            await Bun.sleep(SESSION_IDLE_POLL_MS)
        }
    }

    private async readMessage(
        command: Extract<BindingOpencodeCommand, { kind: "readMessage" }>,
    ): Promise<BindingOpencodeCommandResult> {
        const message = await this.client.session.message({
            path: {
                id: command.sessionId,
                messageID: command.messageId,
            },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

        return {
            kind: "readMessage",
            sessionId: command.sessionId,
            messageId: command.messageId,
            parts: unwrapData<MessageResponse>(message).parts.flatMap(toBindingMessagePart),
        }
    }

    private async listMessages(
        command: Extract<BindingOpencodeCommand, { kind: "listMessages" }>,
    ): Promise<BindingOpencodeCommandResult> {
        const messages = await this.client.session.messages({
            path: { id: command.sessionId },
            query: {
                directory: this.directory,
                limit: 32,
            },
            responseStyle: "data",
            throwOnError: true,
        })

        return {
            kind: "listMessages",
            sessionId: command.sessionId,
            messages: unwrapData<MessageResponse[]>(messages).flatMap(toBindingMessage),
        }
    }
}

function unwrapData<T>(value: MaybeWrapped<T>): T {
    return typeof value === "object" && value !== null && "data" in value ? value.data : value
}

function selectAssistantResponse(messages: MessageResponse[], userMessageId: string): AssistantMessageResponse | null {
    const assistantChildren = messages.filter(isAssistantChildMessage(userMessageId))

    for (let index = assistantChildren.length - 1; index >= 0; index -= 1) {
        const candidate = assistantChildren[index]
        if (hasVisibleText(candidate)) {
            return candidate
        }
    }

    for (let index = assistantChildren.length - 1; index >= 0; index -= 1) {
        const candidate = assistantChildren[index]
        if (candidate.info?.finish === "stop" || candidate.info?.error !== undefined) {
            return candidate
        }
    }

    return null
}

function isAssistantChildMessage(
    userMessageId: string,
): (message: MessageResponse) => message is AssistantMessageResponse {
    return (message): message is AssistantMessageResponse =>
        message.info?.role === "assistant" && message.info.parentID === userMessageId
}

function toBindingMessagePart(part: SessionPromptPart): BindingOpencodeMessagePart[] {
    if (typeof part.id !== "string" || typeof part.messageID !== "string" || part.type.length === 0) {
        return []
    }

    return [
        {
            messageId: part.messageID,
            partId: part.id,
            type: part.type,
            text: typeof part.text === "string" ? part.text : null,
            ignored: part.ignored === true,
        },
    ]
}

function hasVisibleText(message: MessageResponse): boolean {
    return message.parts.some(
        (part) =>
            part.type === "text" && part.ignored !== true && typeof part.text === "string" && part.text.length > 0,
    )
}

function toBindingMessage(message: MessageResponse): BindingOpencodeMessage[] {
    if (
        typeof message.info?.id !== "string" ||
        typeof message.info.role !== "string" ||
        message.info.role.length === 0
    ) {
        return []
    }

    return [
        {
            messageId: message.info.id,
            role: message.info.role,
            parentId: typeof message.info.parentID === "string" ? message.info.parentID : null,
            parts: message.parts.flatMap(toBindingMessagePart),
        },
    ]
}

function toErrorResult(command: BindingOpencodeCommand, error: unknown): BindingOpencodeCommandResult {
    return {
        kind: "error",
        commandKind: command.kind,
        sessionId: "sessionId" in command ? command.sessionId : null,
        code: isMissingSessionError(error) ? "missingSession" : "unknown",
        message: extractErrorMessage(error),
    }
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

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message
    }

    if (typeof error === "string" && error.length > 0) {
        return error
    }

    return "OpenCode command failed"
}
