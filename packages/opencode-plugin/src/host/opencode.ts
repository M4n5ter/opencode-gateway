import type { PluginInput } from "@opencode-ai/plugin"

import type { BindingOpencodeHost, BindingPromptRequest, BindingPromptResult } from "../binding"
import { failedPromptResult, okPromptResult } from "./result"

type OpencodeClient = PluginInput["client"]

type SessionPromptPart = {
    type: string
    text?: string
    ignored?: boolean
}

type MaybeWrapped<T> = T | { data: T }

type SessionRecord = {
    id: string
}

type PromptResponse = {
    parts: SessionPromptPart[]
}

export class GatewayOpencodeHost implements BindingOpencodeHost {
    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
    ) {}

    async runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult> {
        try {
            const sessionId = request.sessionId ?? (await this.createSession(request.conversationKey))
            const response = await this.client.session.prompt({
                path: { id: sessionId },
                query: { directory: this.directory },
                body: {
                    parts: [{ type: "text", text: request.prompt }],
                },
                responseStyle: "data",
                throwOnError: true,
            })

            return okPromptResult(sessionId, extractAssistantText(unwrapData<PromptResponse>(response).parts))
        } catch (error) {
            return failedPromptResult(error)
        }
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
}

function unwrapData<T>(value: MaybeWrapped<T>): T {
    return typeof value === "object" && value !== null && "data" in value ? value.data : value
}

function extractAssistantText(parts: SessionPromptPart[]): string {
    return parts
        .filter(isVisibleTextPart)
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
