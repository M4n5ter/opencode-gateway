import type { PluginInput } from "@opencode-ai/plugin"

import type { BindingOpencodeHost, BindingPromptRequest, BindingPromptResult } from "../binding"

type OpencodeClient = PluginInput["client"]

type SessionPromptPart = {
    type: string
    text?: string
    ignored?: boolean
}

export class GatewayOpencodeHost implements BindingOpencodeHost {
    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
    ) {}

    async runPrompt(request: BindingPromptRequest): Promise<BindingPromptResult> {
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

        return {
            sessionId,
            responseText: extractAssistantText(response.data.parts),
        }
    }

    private async createSession(conversationKey: string): Promise<string> {
        const session = await this.client.session.create({
            body: { title: sessionTitle(conversationKey) },
            query: { directory: this.directory },
            responseStyle: "data",
            throwOnError: true,
        })

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
