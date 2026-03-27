import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import type { PluginInput } from "@opencode-ai/plugin"

import type {
    BindingOpencodeCommand,
    BindingOpencodeCommandPart,
    BindingOpencodeCommandResult,
    BindingOpencodeMessage,
    BindingOpencodeMessagePart,
} from "../binding"
import { delay } from "../runtime/delay"

const SESSION_IDLE_POLL_MS = 250
const DEFAULT_SDK_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_UNTIL_IDLE_TIMEOUT_MS = 30 * 60_000
const DEFAULT_PROMPT_RESPONSE_PROGRESS_TIMEOUT_MS = 30 * 60_000
const DEFAULT_PROMPT_RESPONSE_SETTLE_MS = 1_000

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
    mime?: string
    url?: string
    filename?: string
    ignored?: boolean
}

type PromptInputPart =
    | {
          id: string
          type: "text"
          text: string
      }
    | {
          id: string
          type: "file"
          mime: string
          url: string
          filename: string
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

    async createFreshSession(title: string): Promise<string> {
        const session = await this.client.session.create({
            body: { title },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
        })

        return unwrapData<SessionRecord>(session).id
    }

    async isSessionBusy(sessionId: string): Promise<boolean> {
        const statuses = await this.client.session.status({
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
        })
        const current = unwrapData<Record<string, { type?: string }>>(statuses)[sessionId]
        return current?.type === "busy"
    }

    async abortSession(sessionId: string): Promise<void> {
        try {
            await this.client.session.abort({
                path: { id: sessionId },
                query: { directory: this.directory },
                responseStyle: "data",
                throwOnError: true,
                signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
            })
        } catch (error) {
            if (isMissingSessionError(error)) {
                return
            }

            throw error
        }
    }

    async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
        try {
            switch (command.kind) {
                case "lookupSession":
                    return await this.lookupSession(command.sessionId)
                case "createSession":
                    return await this.createSession(command.title)
                case "waitUntilIdle":
                    return await this.waitUntilIdle(command)
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
                signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
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
        return {
            kind: "createSession",
            sessionId: await this.createFreshSession(title),
        }
    }

    private async waitUntilIdle(
        command: Extract<BindingOpencodeCommand, { kind: "waitUntilIdle" }>,
    ): Promise<BindingOpencodeCommandResult> {
        const timeoutMs = normalizeTimeoutMs(command.timeoutMs, DEFAULT_WAIT_UNTIL_IDLE_TIMEOUT_MS, "timeoutMs")
        const deadlineMs = Date.now() + timeoutMs

        for (;;) {
            const statuses = await this.client.session.status({
                query: { directory: this.directory },
                responseStyle: "data",
                throwOnError: true,
                signal: createRequestSignal(deadlineMs),
            })
            const current = unwrapData<Record<string, { type?: string }>>(statuses)[command.sessionId]
            if (!current || current.type === "idle") {
                return {
                    kind: "waitUntilIdle",
                    sessionId: command.sessionId,
                }
            }

            if (Date.now() >= deadlineMs) {
                throw new OpencodeTimeoutError(`session ${command.sessionId} did not become idle within ${timeoutMs}ms`)
            }

            await delay(Math.min(SESSION_IDLE_POLL_MS, remainingBefore(deadlineMs)))
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
                parts: command.parts.map(toSessionPromptPart),
            },
            responseStyle: "data",
            throwOnError: true,
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
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
                parts: command.parts.map(toSessionPromptPart),
            },
            throwOnError: true,
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
        })

        return {
            kind: "sendPromptAsync",
            sessionId: command.sessionId,
        }
    }

    private async awaitPromptResponse(
        command: Extract<BindingOpencodeCommand, { kind: "awaitPromptResponse" }>,
    ): Promise<BindingOpencodeCommandResult> {
        const startedAtMs = Date.now()
        const progressTimeoutMs = normalizeTimeoutMs(
            command.progressTimeoutMs,
            DEFAULT_PROMPT_RESPONSE_PROGRESS_TIMEOUT_MS,
            "progressTimeoutMs",
        )
        const hardDeadline =
            command.hardTimeoutMs === undefined || command.hardTimeoutMs === null
                ? null
                : startedAtMs + normalizeTimeoutMs(command.hardTimeoutMs, 1, "hardTimeoutMs")
        const settleMs = normalizeTimeoutMs(command.settleMs, DEFAULT_PROMPT_RESPONSE_SETTLE_MS, "settleMs")
        let progressDeadline = startedAtMs + progressTimeoutMs
        let stableCandidateKey: string | null = null
        let stableCandidateSinceMs: number | null = null
        let progressKey: string | null = null

        for (;;) {
            const messages = await this.client.session.messages({
                path: { id: command.sessionId },
                query: {
                    directory: this.directory,
                    limit: 64,
                },
                responseStyle: "data",
                throwOnError: true,
                signal: createRequestSignal(resolvePollDeadline(progressDeadline, hardDeadline)),
            })
            const assistantChildren = listAssistantResponses(unwrapData<MessageResponse[]>(messages), command.messageId)
            const nextProgressKey = createAssistantProgressKey(assistantChildren)
            const now = Date.now()

            if (progressKey !== nextProgressKey) {
                progressKey = nextProgressKey
                progressDeadline = now + progressTimeoutMs
            }

            const response = selectAssistantResponse(assistantChildren)

            if (response !== null) {
                const candidateKey = createAssistantCandidateKey(response)
                if (stableCandidateKey === candidateKey) {
                    if (stableCandidateSinceMs !== null && now - stableCandidateSinceMs >= settleMs) {
                        return toAwaitPromptResponseResult(command.sessionId, response)
                    }
                } else {
                    stableCandidateKey = candidateKey
                    stableCandidateSinceMs = now
                }
            } else {
                stableCandidateKey = null
                stableCandidateSinceMs = null
            }

            if (now >= progressDeadline || (hardDeadline !== null && now >= hardDeadline)) {
                if (response !== null) {
                    return toAwaitPromptResponseResult(command.sessionId, response)
                }

                throw new OpencodeTimeoutError(
                    `assistant message for prompt ${command.messageId} is unavailable before timeout`,
                )
            }

            await delay(
                Math.min(SESSION_IDLE_POLL_MS, remainingBefore(resolvePollDeadline(progressDeadline, hardDeadline))),
            )
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
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
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
            signal: AbortSignal.timeout(DEFAULT_SDK_REQUEST_TIMEOUT_MS),
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

function toSessionPromptPart(part: BindingOpencodeCommandPart): PromptInputPart {
    switch (part.kind) {
        case "text":
            return {
                id: part.partId,
                type: "text",
                text: part.text,
            }
        case "file":
            return {
                id: part.partId,
                type: "file",
                mime: part.mimeType,
                url: pathToFileURL(part.localPath).href,
                filename: part.fileName ?? basename(part.localPath),
            }
    }
}

function listAssistantResponses(messages: MessageResponse[], userMessageId: string): AssistantMessageResponse[] {
    return messages.filter(isAssistantChildMessage(userMessageId))
}

function selectAssistantResponse(assistantChildren: AssistantMessageResponse[]): AssistantMessageResponse | null {
    for (let index = assistantChildren.length - 1; index >= 0; index -= 1) {
        const candidate = assistantChildren[index]
        if (isTerminalAssistantMessage(candidate) && hasVisibleText(candidate)) {
            return candidate
        }
    }

    for (let index = assistantChildren.length - 1; index >= 0; index -= 1) {
        const candidate = assistantChildren[index]
        if (isTerminalAssistantMessage(candidate)) {
            return candidate
        }
    }

    return null
}

function isTerminalAssistantMessage(message: AssistantMessageResponse): boolean {
    if (message.info.error !== undefined) {
        return true
    }

    return typeof message.info.finish === "string" && message.info.finish !== "tool-calls"
}

function createAssistantProgressKey(messages: AssistantMessageResponse[]): string {
    return JSON.stringify(messages.map(createAssistantCandidateKey))
}

function createAssistantCandidateKey(message: AssistantMessageResponse): string {
    return JSON.stringify({
        messageId: message.info.id,
        finish: message.info.finish ?? null,
        hasError: message.info.error !== undefined,
        parts: message.parts.map((part) => ({
            id: part.id ?? null,
            type: part.type,
            text: typeof part.text === "string" ? part.text : null,
            ignored: part.ignored === true,
        })),
    })
}

function isAssistantChildMessage(
    userMessageId: string,
): (message: MessageResponse) => message is AssistantMessageResponse {
    return (message): message is AssistantMessageResponse =>
        message.info?.role === "assistant" && message.info.parentID === userMessageId
}

function toAwaitPromptResponseResult(
    sessionId: string,
    message: AssistantMessageResponse,
): Extract<BindingOpencodeCommandResult, { kind: "awaitPromptResponse" }> {
    return {
        kind: "awaitPromptResponse",
        sessionId,
        messageId: message.info.id,
        parts: message.parts.flatMap(toBindingMessagePart),
    }
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
            part.type === "text" &&
            part.ignored !== true &&
            typeof part.text === "string" &&
            part.text.trim().length > 0,
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
        code: isMissingSessionError(error) ? "missingSession" : isTimeoutError(error) ? "timeout" : "unknown",
        message: extractErrorMessage(error),
    }
}

class OpencodeTimeoutError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "OpencodeTimeoutError"
    }
}

function normalizeTimeoutMs(value: number | null | undefined, fallback: number, field: string): number {
    if (value === undefined || value === null) {
        return fallback
    }

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${field} must be a positive integer`)
    }

    return value
}

function createRequestSignal(deadlineMs: number): AbortSignal {
    return AbortSignal.timeout(remainingBefore(deadlineMs))
}

function resolvePollDeadline(progressDeadlineMs: number, hardDeadlineMs: number | null): number {
    if (hardDeadlineMs === null) {
        return progressDeadlineMs
    }

    return Math.min(progressDeadlineMs, hardDeadlineMs)
}

function remainingBefore(deadlineMs: number): number {
    return Math.max(1, deadlineMs - Date.now())
}

function isMissingSessionError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false
    }

    const name = "name" in error ? error.name : undefined
    const message = "data" in error ? extractDataMessage(error.data) : null
    return name === "NotFoundError" && message?.includes("Session not found:") === true
}

function isTimeoutError(error: unknown): boolean {
    if (error instanceof OpencodeTimeoutError) {
        return true
    }

    if (typeof error !== "object" || error === null) {
        return false
    }

    const name = "name" in error ? error.name : undefined
    return name === "TimeoutError" || name === "AbortError"
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
