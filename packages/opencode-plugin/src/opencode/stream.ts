import type { PluginInput } from "@opencode-ai/plugin"

import type { ExecutionHandle } from "../binding"
import type { OpencodeEventHub } from "./events"
import type { OpencodePromptIds } from "./message-ids"

type OpencodeClient = PluginInput["client"]
type TextSnapshotHandler = (text: string) => Promise<void> | void

const PREVIEW_ESTABLISH_WINDOW_MS = 500
const SESSION_IDLE_POLL_MS = 250

export async function streamPromptText(
    client: OpencodeClient,
    directory: string,
    events: OpencodeEventHub,
    sessionId: string,
    prompt: string,
    ids: OpencodePromptIds,
    execution: ExecutionHandle,
    onSnapshot: TextSnapshotHandler | null,
): Promise<string> {
    let previewEstablished = false
    let resolvePreviewEstablished: (() => void) | null = null
    const previewEstablishedPromise = new Promise<void>((resolve) => {
        resolvePreviewEstablished = resolve
    })
    const pendingPrompt = events.registerPrompt(sessionId, execution, ids.messageId, async (text) => {
        if (onSnapshot !== null) {
            if (!previewEstablished) {
                previewEstablished = true
                resolvePreviewEstablished?.()
                resolvePreviewEstablished = null
            }

            await onSnapshot(text)
        }
    })

    try {
        await client.session.promptAsync({
            path: { id: sessionId },
            query: { directory },
            body: {
                messageID: ids.messageId,
                parts: [{ id: ids.textPartId, type: "text", text: prompt }],
            },
            responseStyle: "data",
            throwOnError: true,
        })

        if (onSnapshot !== null && !previewEstablished) {
            await Promise.race([previewEstablishedPromise, Bun.sleep(PREVIEW_ESTABLISH_WINDOW_MS)])
        }

        const assistantMessageId = await pendingPrompt.waitForAssistantMessageId()
        await waitUntilSessionIdle(client, directory, sessionId)
        return await readFinalResponseText(client, directory, sessionId, assistantMessageId)
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
    messageId: string,
): Promise<string> {
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

export async function appendPromptText(
    client: OpencodeClient,
    directory: string,
    sessionId: string,
    prompt: string,
    ids: OpencodePromptIds,
): Promise<void> {
    await client.session.promptAsync({
        path: { id: sessionId },
        query: { directory },
        body: {
            messageID: ids.messageId,
            noReply: true,
            parts: [{ id: ids.textPartId, type: "text", text: prompt }],
        },
        responseStyle: "data",
        throwOnError: true,
    })
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

async function waitUntilSessionIdle(client: OpencodeClient, directory: string, sessionId: string): Promise<void> {
    for (;;) {
        const statuses = await client.session.status({
            query: { directory },
            responseStyle: "data",
            throwOnError: true,
        })
        const sessionStatus = unwrapData<Record<string, { type?: string }>>(statuses)[sessionId]
        if (!sessionStatus || sessionStatus.type === "idle") {
            return
        }

        await Bun.sleep(SESSION_IDLE_POLL_MS)
    }
}
