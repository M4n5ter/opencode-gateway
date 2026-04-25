import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayFetch } from "../http/proxy"
import { TelegramBotClient } from "./client"

type FetchCall = {
    input: string | URL | Request
    init: RequestInit | undefined
}

test("TelegramBotClient sends JSON API calls through the injected fetch", async () => {
    const { calls, gatewayFetch } = createRecordingFetch(() =>
        Response.json({
            ok: true,
            result: [],
        }),
    )
    const client = new TelegramBotClient("secret", gatewayFetch)

    const updates = await client.getUpdates(12, 25)

    expect(updates).toEqual([])
    expect(calls).toHaveLength(1)
    expect(String(calls[0].input)).toBe("https://api.telegram.org/botsecret/getUpdates")
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        offset: 12,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
    })
})

test("TelegramBotClient sends multipart uploads through the injected fetch", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-telegram-client-"))
    const filePath = join(root, "photo.txt")
    const { calls, gatewayFetch } = createRecordingFetch(() =>
        Response.json({
            ok: true,
            result: {},
        }),
    )

    try {
        await writeFile(filePath, "hello")
        const client = new TelegramBotClient("secret", gatewayFetch)

        await client.sendPhoto("42", filePath, "caption", null, "text/plain")

        expect(calls).toHaveLength(1)
        expect(String(calls[0].input)).toBe("https://api.telegram.org/botsecret/sendPhoto")
        expect(calls[0].init?.method).toBe("POST")
        expect(calls[0].init?.body).toBeInstanceOf(FormData)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("TelegramBotClient downloads files through the injected fetch", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-telegram-client-"))
    const outputPath = join(root, "download.txt")
    const { calls, gatewayFetch } = createRecordingFetch(() => new Response("downloaded"))

    try {
        const client = new TelegramBotClient("secret", gatewayFetch)

        await client.downloadFile("photos/file.txt", outputPath)

        expect(calls).toHaveLength(1)
        expect(String(calls[0].input)).toBe("https://api.telegram.org/file/botsecret/photos/file.txt")
        expect(await readFile(outputPath, "utf8")).toBe("downloaded")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

function createRecordingFetch(responseFactory: () => Response): {
    calls: FetchCall[]
    gatewayFetch: GatewayFetch
} {
    const calls: FetchCall[] = []

    return {
        calls,
        gatewayFetch: async (input, init) => {
            calls.push({ input, init })
            return responseFactory()
        },
    }
}
