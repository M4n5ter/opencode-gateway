import type { TelegramInlineKeyboardMarkup } from "../telegram/types"
import type { GatewayInflightPolicyReply, GatewayInflightPolicyRequest } from "./types"

const QUEUE_WORDS = new Set(["/queue", "queue"])
const INTERRUPT_WORDS = new Set(["/interrupt", "interrupt"])

export type ParsedInflightPolicyReply =
    | {
          kind: "reply"
          reply: GatewayInflightPolicyReply
      }
    | {
          kind: "pass_through"
      }

export function formatPlainTextInflightPolicy(_request: GatewayInflightPolicyRequest): string {
    return [
        "A task is still running for this conversation.",
        "",
        "New messages will be held until you choose what to do next.",
        "",
        "How to reply:",
        "- Reply /queue to let the current task finish, then handle the held messages next.",
        "- Reply /interrupt to stop the current task and switch to the held messages.",
    ].join("\n")
}

export function formatTelegramInflightPolicy(_request: GatewayInflightPolicyRequest): string {
    return [
        "<b>A task is still running for this conversation.</b>",
        "",
        "New messages will be held until you choose what to do next.",
        "",
        "Tap a button below or reply with text.",
    ].join("\n")
}

export function buildTelegramInflightPolicyKeyboard(): TelegramInlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: "Queue Next",
                    callback_data: "i:queue",
                },
                {
                    text: "Interrupt Current",
                    callback_data: "i:interrupt",
                },
            ],
        ],
    }
}

export function parseInflightPolicyReply(text: string | null): ParsedInflightPolicyReply {
    if (text === null) {
        return {
            kind: "pass_through",
        }
    }

    const normalized = text.trim().toLowerCase()
    if (normalized.length === 0) {
        return {
            kind: "pass_through",
        }
    }

    if (QUEUE_WORDS.has(normalized)) {
        return {
            kind: "reply",
            reply: "queue",
        }
    }

    if (INTERRUPT_WORDS.has(normalized)) {
        return {
            kind: "reply",
            reply: "interrupt",
        }
    }

    return {
        kind: "pass_through",
    }
}

export function resolveInflightPolicyCallbackReply(data: string | null): GatewayInflightPolicyReply | null {
    if (data === "i:queue") {
        return "queue"
    }

    if (data === "i:interrupt") {
        return "interrupt"
    }

    return null
}

export function formatInflightPolicyCallbackAck(reply: GatewayInflightPolicyReply): string {
    switch (reply) {
        case "queue":
            return "Queued for next turn."
        case "interrupt":
            return "Interrupting current task."
    }
}
