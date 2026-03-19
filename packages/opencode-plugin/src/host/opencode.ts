import type { PluginInput } from "@opencode-ai/plugin"

import type { BindingOpencodeHost, BindingPromptRequest } from "../binding"

type OpencodeClient = PluginInput["client"]

type SessionPromptPart = {
    type: string
    text?: string
    ignored?: boolean
}

export class GatewayOpencodeHost implements BindingOpencodeHost {
    private readonly sessions = new Map<string, string>()

    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
    ) {}

    async runPrompt(request: BindingPromptRequest): Promise<string> {
        const sessionId = await this.resolveSessionID(request.conversationKey)
        const response = await this.client.session.prompt({
            path: { id: sessionId },
            query: { directory: this.directory },
            body: {
                parts: [{ type: "text", text: request.prompt }],
            },
            responseStyle: "data",
            throwOnError: true,
        })

        return extractAssistantText(response.data.parts)
    }

    private async resolveSessionID(conversationKey: string): Promise<string> {
        const existing = this.sessions.get(conversationKey)
        if (existing) {
            return existing
        }

        const session = await this.client.session.create({
            body: { title: sessionTitle(conversationKey) },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

        this.sessions.set(conversationKey, session.data.id)
        return session.data.id
    }
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
