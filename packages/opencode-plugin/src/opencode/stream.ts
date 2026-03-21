import type { PluginInput } from "@opencode-ai/plugin"

import type { ExecutionHandle } from "../binding"
import type { OpencodeEventHub } from "./events"

type OpencodeClient = PluginInput["client"]
type TextSnapshotHandler = (text: string) => Promise<void> | void

const PREVIEW_ESTABLISH_WINDOW_MS = 500

export async function streamPromptText(
    client: OpencodeClient,
    directory: string,
    events: OpencodeEventHub,
    sessionId: string,
    prompt: string,
    execution: ExecutionHandle,
    onSnapshot: TextSnapshotHandler,
): Promise<string> {
    let previewEstablished = false
    let resolvePreviewEstablished: (() => void) | null = null
    const previewEstablishedPromise = new Promise<void>((resolve) => {
        resolvePreviewEstablished = resolve
    })
    const pendingPrompt = events.registerPrompt(sessionId, execution, async (text) => {
        if (!previewEstablished) {
            previewEstablished = true
            resolvePreviewEstablished?.()
            resolvePreviewEstablished = null
        }

        await onSnapshot(text)
    })

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

        if (!previewEstablished) {
            await Promise.race([previewEstablishedPromise, Bun.sleep(PREVIEW_ESTABLISH_WINDOW_MS)])
        }

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
        .map((part) => part.text)
        .filter((text) => text.length > 0)
        .join("\n")
}

function unwrapData<T>(value: MaybeWrapped<T>): T {
    return typeof value === "object" && value !== null && "data" in value ? value.data : value
}
