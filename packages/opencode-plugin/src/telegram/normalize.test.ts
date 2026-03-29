import { expect, test } from "bun:test"

import { GatewayMailboxRouter } from "../mailbox/router"
import { buildTelegramAllowlist, normalizeTelegramUpdate } from "./normalize"

const allowlist = buildTelegramAllowlist({
    enabled: true,
    botToken: "secret",
    botTokenEnv: "TELEGRAM_BOT_TOKEN",
    pollTimeoutSeconds: 25,
    allowedChats: ["-100123"],
    allowedUsers: ["42"],
})

test("normalizeTelegramUpdate accepts allowlisted private text messages", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 10,
            message: {
                message_id: 1,
                text: "hello",
                from: { id: 42 },
                chat: { id: 42, type: "private" },
            },
        },
        allowlist,
    )

    expect(result).toEqual({
        kind: "message",
        chatType: "private",
        message: {
            mailboxKey: null,
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            sender: "telegram:42",
            text: "hello",
            attachments: [],
            replyContext: null,
        },
    })
})

test("normalizeTelegramUpdate accepts allowlisted photo messages with caption", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 11,
            message: {
                message_id: 2,
                caption: "look",
                photo: [
                    {
                        file_id: "small",
                        width: 32,
                        height: 32,
                    },
                    {
                        file_id: "large",
                        file_unique_id: "photo-1",
                        width: 640,
                        height: 640,
                    },
                ],
                from: { id: 42 },
                chat: { id: 42, type: "private" },
            },
        },
        allowlist,
    )

    expect(result).toEqual({
        kind: "message",
        chatType: "private",
        message: {
            mailboxKey: null,
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            sender: "telegram:42",
            text: "look",
            attachments: [
                {
                    kind: "image",
                    fileId: "large",
                    fileUniqueId: "photo-1",
                    mimeType: null,
                    fileName: null,
                },
            ],
            replyContext: null,
        },
    })
})

test("normalizeTelegramUpdate captures direct reply context for the replied message", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 15,
            message: {
                message_id: 7,
                text: "please revise it",
                reply_to_message: {
                    message_id: 6,
                    text: "first draft",
                    from: { id: 900, is_bot: true },
                },
                from: { id: 42 },
                chat: { id: 42, type: "private" },
            },
        },
        allowlist,
    )

    expect(result).toEqual({
        kind: "message",
        chatType: "private",
        message: {
            mailboxKey: null,
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            sender: "telegram:42",
            text: "please revise it",
            attachments: [],
            replyContext: {
                messageId: "6",
                sender: "telegram:900",
                senderIsBot: true,
                text: "first draft",
                textTruncated: false,
                attachments: [],
            },
        },
    })
})

test("normalizeTelegramUpdate truncates long reply text and summarizes reply image attachments", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 16,
            message: {
                message_id: 8,
                text: "follow up",
                reply_to_message: {
                    message_id: 7,
                    caption: "x".repeat(1_600),
                    document: {
                        file_id: "doc-2",
                        file_name: "photo.png",
                        mime_type: "image/png",
                    },
                    from: { id: 77, is_bot: false },
                },
                from: { id: 42 },
                chat: { id: 42, type: "private" },
            },
        },
        allowlist,
    )

    expect(result).toMatchObject({
        kind: "message",
        message: {
            replyContext: {
                messageId: "7",
                sender: "telegram:77",
                senderIsBot: false,
                textTruncated: true,
                attachments: [
                    {
                        kind: "image",
                        mimeType: "image/png",
                        fileName: "photo.png",
                    },
                ],
            },
        },
    })
    expect(result.kind).toBe("message")
    if (result.kind === "message") {
        expect(result.message.replyContext?.text).toHaveLength(1_500)
    }
})

test("normalizeTelegramUpdate preserves Telegram topics and mailbox overrides", () => {
    const router = new GatewayMailboxRouter([
        {
            channel: "telegram",
            target: "-100123",
            topic: "99",
            mailboxKey: "shared:alpha",
        },
    ])

    const result = normalizeTelegramUpdate(
        {
            update_id: 12,
            message: {
                message_id: 3,
                message_thread_id: 99,
                document: {
                    file_id: "doc-1",
                    file_unique_id: "doc-unique",
                    file_name: "chart.png",
                    mime_type: "image/png",
                },
                from: { id: 7 },
                chat: { id: -100123, type: "supergroup" },
            },
        },
        allowlist,
        router,
    )

    expect(result).toEqual({
        kind: "message",
        chatType: "supergroup",
        message: {
            mailboxKey: "shared:alpha",
            deliveryTarget: {
                channel: "telegram",
                target: "-100123",
                topic: "99",
            },
            sender: "telegram:7",
            text: null,
            attachments: [
                {
                    kind: "image",
                    fileId: "doc-1",
                    fileUniqueId: "doc-unique",
                    mimeType: "image/png",
                    fileName: "chart.png",
                },
            ],
            replyContext: null,
        },
    })
})

test("normalizeTelegramUpdate ignores bot, unsupported, and non-allowlisted messages", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 13,
                message: {
                    message_id: 4,
                    text: "hello",
                    from: { id: 9, is_bot: true },
                    chat: { id: 9, type: "private" },
                },
            },
            allowlist,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message sender is a bot",
    })

    expect(
        normalizeTelegramUpdate(
            {
                update_id: 14,
                message: {
                    message_id: 5,
                    from: { id: 42 },
                    chat: { id: 42, type: "private" },
                },
            },
            allowlist,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message has no supported content",
    })

    expect(
        normalizeTelegramUpdate(
            {
                update_id: 17,
                message: {
                    message_id: 6,
                    text: "hello",
                    from: { id: 8 },
                    chat: { id: 1000, type: "private" },
                },
            },
            allowlist,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message is not allowlisted",
    })
})
