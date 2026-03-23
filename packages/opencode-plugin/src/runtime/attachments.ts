import { rm } from "node:fs/promises"

import type { BindingLoggerHost } from "../binding"
import type { MailboxEntryRecord } from "../store/sqlite"

export async function deleteInboundAttachmentFiles(
    entries: Pick<MailboxEntryRecord, "attachments">[],
    logger: Pick<BindingLoggerHost, "log">,
): Promise<void> {
    const paths = new Set(entries.flatMap((entry) => entry.attachments.map((attachment) => attachment.localPath)))

    await Promise.all(
        [...paths].map(async (path) => {
            try {
                await rm(path, { force: true })
            } catch (error) {
                logger.log("warn", `failed to remove cached inbound attachment ${path}: ${String(error)}`)
            }
        }),
    )
}
