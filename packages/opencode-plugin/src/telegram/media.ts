import { mkdir } from "node:fs/promises"
import { basename, extname, join } from "node:path"

import type { BindingInboundAttachment, BindingInboundMessage } from "../binding"
import { inferLocalFileMimeType } from "../media/mime"
import type { TelegramBotClient } from "./client"
import type { TelegramNormalizedInboundMessage, TelegramPendingAttachment } from "./normalize"

export class TelegramInboundMediaStore {
    constructor(
        private readonly client: TelegramMediaClientLike,
        private readonly mediaRootPath: string,
    ) {}

    async materializeInboundMessage(
        message: TelegramNormalizedInboundMessage,
        sourceKind: string,
        externalId: string,
    ): Promise<BindingInboundMessage> {
        return {
            deliveryTarget: message.deliveryTarget,
            sender: message.sender,
            text: message.text,
            attachments: await Promise.all(
                message.attachments.map((attachment, index) =>
                    this.materializeAttachment(attachment, sourceKind, externalId, index),
                ),
            ),
            mailboxKey: message.mailboxKey,
            ...(message.replyContext == null ? {} : { replyContext: message.replyContext }),
        }
    }

    private async materializeAttachment(
        attachment: TelegramPendingAttachment,
        sourceKind: string,
        externalId: string,
        ordinal: number,
    ): Promise<BindingInboundAttachment> {
        switch (attachment.kind) {
            case "image":
                return await this.materializeImageAttachment(attachment, sourceKind, externalId, ordinal)
        }
    }

    private async materializeImageAttachment(
        attachment: Extract<TelegramPendingAttachment, { kind: "image" }>,
        sourceKind: string,
        externalId: string,
        ordinal: number,
    ): Promise<BindingInboundAttachment> {
        const file = await this.client.getFile(attachment.fileId)
        const remotePath = file.file_path?.trim()
        if (!remotePath) {
            throw new Error(`Telegram file ${attachment.fileId} did not include file_path`)
        }

        const fileName =
            normalizeOptionalFileName(attachment.fileName) ??
            normalizeOptionalFileName(basename(remotePath)) ??
            `telegram-image-${ordinal + 1}${extensionFromRemotePath(remotePath)}`
        const localPath = join(
            this.mediaRootPath,
            "telegram",
            sanitizePathSegment(sourceKind),
            sanitizePathSegment(externalId),
            `${ordinal}-${sanitizePathSegment(fileName)}`,
        )

        await mkdir(
            join(this.mediaRootPath, "telegram", sanitizePathSegment(sourceKind), sanitizePathSegment(externalId)),
            {
                recursive: true,
            },
        )
        await this.client.downloadFile(remotePath, localPath)

        return {
            kind: "image",
            mimeType: attachment.mimeType ?? (await inferLocalFileMimeType(localPath)),
            fileName,
            localPath,
        }
    }
}

type TelegramMediaClientLike = Pick<TelegramBotClient, "getFile" | "downloadFile">

function sanitizePathSegment(value: string): string {
    return (
        value
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 120) || "file"
    )
}

function normalizeOptionalFileName(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function extensionFromRemotePath(remotePath: string): string {
    const extension = extname(remotePath)
    return extension.length === 0 ? ".bin" : extension
}
