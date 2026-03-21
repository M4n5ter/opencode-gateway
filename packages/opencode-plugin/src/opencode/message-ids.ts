export type OpencodePromptIds = {
    messageId: string
    textPartId: string
}

export function createMailboxPromptIds(entryId: number): OpencodePromptIds {
    if (!Number.isSafeInteger(entryId) || entryId <= 0) {
        throw new Error(`mailbox entry id is invalid: ${entryId}`)
    }

    return {
        messageId: `msg_gateway_mailbox_${entryId}`,
        textPartId: `prt_gateway_mailbox_${entryId}`,
    }
}
