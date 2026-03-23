import { stat } from "node:fs/promises"
import { isAbsolute } from "node:path"

import type { BindingDeliveryTarget } from "../binding"
import { inferLocalFileMimeType, isImageMimeType } from "../media/mime"
import type { TelegramFileSendClientLike } from "../telegram/client"

export type ChannelFileSendResult = {
    channel: string
    target: string
    topic: string | null
    filePath: string
    mimeType: string
    deliveryKind: "photo" | "document"
}

export class ChannelFileSender {
    constructor(private readonly telegramClient: TelegramFileSendClientLike | null) {}

    hasEnabledChannel(): boolean {
        return this.telegramClient !== null
    }

    async sendFile(
        target: BindingDeliveryTarget,
        filePath: string,
        caption: string | null,
    ): Promise<ChannelFileSendResult> {
        const normalizedPath = normalizeAbsoluteFilePath(filePath)
        await assertRegularFile(normalizedPath)

        const mimeType = await inferLocalFileMimeType(normalizedPath)
        if (target.channel !== "telegram") {
            throw new Error(`unsupported outbound channel: ${target.channel}`)
        }

        if (this.telegramClient === null) {
            throw new Error("telegram transport is not configured")
        }

        if (isImageMimeType(mimeType)) {
            await this.telegramClient.sendPhoto(target.target, normalizedPath, caption, target.topic, mimeType)
            return {
                channel: target.channel,
                target: target.target,
                topic: target.topic,
                filePath: normalizedPath,
                mimeType,
                deliveryKind: "photo",
            }
        }

        await this.telegramClient.sendDocument(target.target, normalizedPath, caption, target.topic, mimeType)
        return {
            channel: target.channel,
            target: target.target,
            topic: target.topic,
            filePath: normalizedPath,
            mimeType,
            deliveryKind: "document",
        }
    }
}

function normalizeAbsoluteFilePath(filePath: string): string {
    const trimmed = filePath.trim()
    if (trimmed.length === 0) {
        throw new Error("file_path must not be empty")
    }

    if (!isAbsolute(trimmed)) {
        throw new Error("file_path must be an absolute path")
    }

    return trimmed
}

async function assertRegularFile(filePath: string): Promise<void> {
    const metadata = await stat(filePath)
    if (!metadata.isFile()) {
        throw new Error(`file_path is not a regular file: ${filePath}`)
    }
}
