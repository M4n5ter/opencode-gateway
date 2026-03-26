import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

type GatewayPluginClient = PluginInput["client"]

type ClientConfigSnapshot = {
    baseUrl?: string
    headers?: unknown
}

export function createInteractionClient(
    client: GatewayPluginClient,
    serverUrl: URL,
    directory: string,
): ReturnType<typeof createOpencodeClient> {
    const snapshot = readClientConfig(client)

    return createOpencodeClient({
        baseUrl: snapshot.baseUrl ?? serverUrl.toString(),
        directory,
        headers: stripManagedHeaders(snapshot.headers),
    })
}

function readClientConfig(client: GatewayPluginClient): ClientConfigSnapshot {
    const configReader = (
        client as GatewayPluginClient & {
            _client?: {
                getConfig?: () => ClientConfigSnapshot
            }
        }
    )._client?.getConfig

    if (typeof configReader !== "function") {
        return {}
    }

    return configReader() ?? {}
}

function stripManagedHeaders(headers: unknown): Record<string, string> | undefined {
    if (headers === undefined) {
        return undefined
    }

    const normalized = new Headers(toHeadersInit(headers))
    normalized.delete("x-opencode-directory")

    const result = Object.fromEntries(normalized.entries())
    return Object.keys(result).length === 0 ? undefined : result
}

function toHeadersInit(headers: unknown): HeadersInit {
    if (headers instanceof Headers || Array.isArray(headers)) {
        return headers
    }

    if (typeof headers === "object" && headers !== null) {
        return Object.fromEntries(
            Object.entries(headers)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                .map(([key, value]) => [key, value]),
        )
    }

    return {}
}
