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
    allowedBotUsers: ["700"],
    ux: {
        toolCallView: "toggle",
        compactionReaction: true,
        compactionReactionEmoji: "🗜️",
    },
})

const botIdentity = {
    id: "900",
    username: "gateway_bot",
}

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
        botIdentity,
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
        botIdentity,
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
        botIdentity,
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
        botIdentity,
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

test("normalizeTelegramUpdate preserves Telegram topics and mailbox overrides for allowlisted group mentions", () => {
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
                caption: "@gateway_bot chart",
                caption_entities: [{ offset: 0, length: 12, type: "mention" }],
                document: {
                    file_id: "doc-1",
                    file_unique_id: "doc-unique",
                    file_name: "chart.png",
                    mime_type: "image/png",
                },
                from: { id: 42 },
                chat: { id: -100123, type: "supergroup" },
            },
        },
        allowlist,
        botIdentity,
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
            sender: "telegram:42",
            text: "@gateway_bot chart",
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

test("normalizeTelegramUpdate ignores unsupported and non-allowlisted private messages", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 13,
                message: {
                    message_id: 5,
                    from: { id: 42 },
                    chat: { id: 42, type: "private" },
                },
            },
            allowlist,
            botIdentity,
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
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message is not allowlisted",
    })
})

test("normalizeTelegramUpdate accepts allowlisted group mentions from allowlisted users", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 18,
            message: {
                message_id: 9,
                text: "@gateway_bot hello",
                entities: [{ offset: 0, length: 12, type: "mention" }],
                from: { id: 42 },
                chat: { id: -100123, type: "group" },
            },
        },
        allowlist,
        botIdentity,
    )

    expect(result).toMatchObject({
        kind: "message",
        chatType: "group",
        message: {
            sender: "telegram:42",
            text: "@gateway_bot hello",
        },
    })
})

test("normalizeTelegramUpdate ignores group mentions from users outside allowed_users", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 19,
                message: {
                    message_id: 10,
                    text: "@gateway_bot hello",
                    entities: [{ offset: 0, length: 12, type: "mention" }],
                    from: { id: 88 },
                    chat: { id: -100123, type: "group" },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message is not allowlisted",
    })
})

test("normalizeTelegramUpdate ignores group mentions from allowlisted users outside allowed chats", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 20,
                message: {
                    message_id: 11,
                    text: "@gateway_bot hello",
                    entities: [{ offset: 0, length: 12, type: "mention" }],
                    from: { id: 42 },
                    chat: { id: -100999, type: "supergroup" },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message is not allowlisted",
    })
})

test("normalizeTelegramUpdate accepts allowlisted group mentions from allowlisted bots", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 21,
            message: {
                message_id: 12,
                text: "@gateway_bot ping",
                entities: [{ offset: 0, length: 12, type: "mention" }],
                from: { id: 700, is_bot: true },
                chat: { id: -100123, type: "supergroup" },
            },
        },
        allowlist,
        botIdentity,
    )

    expect(result).toMatchObject({
        kind: "message",
        chatType: "supergroup",
        message: {
            sender: "telegram:700",
            text: "@gateway_bot ping",
        },
    })
})

test("normalizeTelegramUpdate ignores group bot mentions outside allowed_bot_users", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 22,
                message: {
                    message_id: 13,
                    text: "@gateway_bot ping",
                    entities: [{ offset: 0, length: 12, type: "mention" }],
                    from: { id: 701, is_bot: true },
                    chat: { id: -100123, type: "group" },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "message is not allowlisted",
    })
})

test("normalizeTelegramUpdate ignores allowlisted group messages that do not mention the current bot", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 23,
                message: {
                    message_id: 14,
                    text: "hello there",
                    from: { id: 42 },
                    chat: { id: -100123, type: "group" },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "group message does not mention bot",
    })
})

test("normalizeTelegramUpdate accepts allowlisted group replies to the current bot without a mention", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 24,
            message: {
                message_id: 15,
                text: "follow up without mention",
                reply_to_message: {
                    message_id: 14,
                    text: "prior bot answer",
                    from: { id: 900, is_bot: true, username: "gateway_bot" },
                },
                from: { id: 42 },
                chat: { id: -100123, type: "group" },
            },
        },
        allowlist,
        botIdentity,
    )

    expect(result).toEqual({
        kind: "message",
        chatType: "group",
        message: {
            mailboxKey: null,
            deliveryTarget: {
                channel: "telegram",
                target: "-100123",
                topic: null,
            },
            sender: "telegram:42",
            text: "follow up without mention",
            attachments: [],
            replyContext: {
                messageId: "14",
                sender: "telegram:900",
                senderIsBot: true,
                text: "prior bot answer",
                textTruncated: false,
                attachments: [],
            },
        },
    })
})

test("normalizeTelegramUpdate ignores allowlisted group replies to non-bot users without a mention", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 25,
                message: {
                    message_id: 16,
                    text: "replying to someone else",
                    reply_to_message: {
                        message_id: 15,
                        text: "prior human answer",
                        from: { id: 901, is_bot: false, username: "another_user" },
                    },
                    from: { id: 42 },
                    chat: { id: -100123, type: "supergroup" },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "group message does not mention bot",
    })
})

test("normalizeTelegramUpdate accepts callback queries from allowlisted group users in allowlisted chats", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 26,
            callback_query: {
                id: "cbq-1",
                from: { id: 42 },
                data: "toggle:view",
                message: {
                    message_id: 15,
                    chat: { id: -100123, type: "group" },
                },
            },
        },
        allowlist,
        botIdentity,
    )

    expect(result).toEqual({
        kind: "callbackQuery",
        callbackQuery: {
            callbackQueryId: "cbq-1",
            sender: "telegram:42",
            deliveryTarget: {
                channel: "telegram",
                target: "-100123",
                topic: null,
            },
            messageId: 15,
            data: "toggle:view",
        },
    })
})

test("normalizeTelegramUpdate ignores callback queries from allowlisted users in non-allowlisted group chats", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 27,
                callback_query: {
                    id: "cbq-2",
                    from: { id: 42 },
                    data: "toggle:view",
                    message: {
                        message_id: 16,
                        chat: { id: -100999, type: "supergroup" },
                    },
                },
            },
            allowlist,
            botIdentity,
        ),
    ).toEqual({
        kind: "ignore",
        reason: "callback query is not allowlisted",
    })
})
