import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ChannelFileSender } from "./file-sender"

test("ChannelFileSender sends images as photos using detected MIME", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-file-sender-"))
    const imagePath = join(root, "sample")
    const sent: Array<{ kind: string; path: string; mimeType: string }> = []

    try {
        await writeFile(imagePath, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

        const sender = new ChannelFileSender({
            async sendPhoto(
                _chatId: string,
                filePath: string,
                _caption: string | null | undefined,
                _topic: string | null | undefined,
                mimeType: string,
            ) {
                sent.push({ kind: "photo", path: filePath, mimeType })
            },
            async sendDocument() {
                throw new Error("unexpected document send")
            },
        })

        const result = await sender.sendFile(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            imagePath,
            null,
        )

        expect(result.deliveryKind).toBe("photo")
        expect(result.mimeType).toBe("image/png")
        expect(sent).toEqual([{ kind: "photo", path: imagePath, mimeType: "image/png" }])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("ChannelFileSender sends non-images as documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-file-sender-"))
    const filePath = join(root, "note.txt")
    const sent: Array<{ kind: string; path: string; mimeType: string }> = []

    try {
        await writeFile(filePath, "hello")

        const sender = new ChannelFileSender({
            async sendPhoto() {
                throw new Error("unexpected photo send")
            },
            async sendDocument(
                _chatId: string,
                path: string,
                _caption: string | null | undefined,
                _topic: string | null | undefined,
                mimeType: string,
            ) {
                sent.push({ kind: "document", path, mimeType })
            },
        })

        const result = await sender.sendFile(
            {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            filePath,
            "note",
        )

        expect(result.deliveryKind).toBe("document")
        expect(sent).toEqual([{ kind: "document", path: filePath, mimeType: "text/plain" }])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
