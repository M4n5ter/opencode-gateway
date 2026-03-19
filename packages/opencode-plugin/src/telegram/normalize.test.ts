import { expect, test } from "bun:test"

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
        message: {
            deliveryTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            sender: "telegram:42",
            body: "hello",
        },
    })
})

test("normalizeTelegramUpdate preserves Telegram topics for allowlisted group messages", () => {
    const result = normalizeTelegramUpdate(
        {
            update_id: 11,
            message: {
                message_id: 2,
                message_thread_id: 99,
                text: "status",
                from: { id: 7 },
                chat: { id: -100123, type: "supergroup" },
            },
        },
        allowlist,
    )

    expect(result).toEqual({
        kind: "message",
        message: {
            deliveryTarget: {
                channel: "telegram",
                target: "-100123",
                topic: "99",
            },
            sender: "telegram:7",
            body: "status",
        },
    })
})

test("normalizeTelegramUpdate ignores bot and non-allowlisted messages", () => {
    expect(
        normalizeTelegramUpdate(
            {
                update_id: 12,
                message: {
                    message_id: 3,
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
                update_id: 13,
                message: {
                    message_id: 4,
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
