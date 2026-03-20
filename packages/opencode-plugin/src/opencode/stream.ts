import type { PluginInput } from "@opencode-ai/plugin"

import type { OpencodeEventHub } from "./events"

type OpencodeClient = PluginInput["client"]
type TextSnapshotHandler = (text: string) => Promise<void> | void

export async function streamPromptText(
    client: OpencodeClient,
    directory: string,
    events: OpencodeEventHub,
    sessionId: string,
    prompt: string,
    onSnapshot: TextSnapshotHandler,
): Promise<string> {
    const pendingPrompt = events.registerPrompt(sessionId, onSnapshot)

    try {
        const response = await client.session.prompt({
            path: { id: sessionId },
            query: { directory },
            body: {
                parts: [{ type: "text", text: prompt }],
            },
            responseStyle: "data",
            throwOnError: true,
        })

        const payload = unwrapData<PromptResponse>(response)
        return await readFinalResponseText(client, directory, sessionId, payload)
    } finally {
        pendingPrompt.dispose()
    }
}

type MaybeWrapped<T> = T | { data: T }

type PromptResponse = {
    info?: {
        id: string
    }
    parts: Array<{
        messageID?: string
        type: string
        text?: string
        ignored?: boolean
    }>
}

async function readFinalResponseText(
    client: OpencodeClient,
    directory: string,
    sessionId: string,
    payload: PromptResponse,
): Promise<string> {
    const messageId = payload.info?.id
    if (!messageId) {
        return extractVisibleTextParts(payload.parts, null)
    }

    const message = await client.session.message({
        path: {
            id: sessionId,
            messageID: messageId,
        },
        query: { directory },
        responseStyle: "data",
        throwOnError: true,
    })

    return extractVisibleTextParts(unwrapData<PromptResponse>(message).parts, messageId)
}

function extractVisibleTextParts(parts: PromptResponse["parts"], messageId: string | null): string {
    return parts
        .filter((part): part is PromptResponse["parts"][number] & { type: "text"; text: string } => {
            return (
                (messageId === null || part.messageID === messageId) &&
                part.type === "text" &&
                typeof part.text === "string" &&
                part.ignored !== true
            )
        })
        .map((part) => part.text.trim())
        .filter((text) => text.length > 0)
        .join("\n")
}

function unwrapData<T>(value: MaybeWrapped<T>): T {
    return typeof value === "object" && value !== null && "data" in value ? value.data : value
}
