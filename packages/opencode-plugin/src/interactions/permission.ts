import { escapeTelegramHtml } from "../telegram/markdown"
import type { TelegramInlineKeyboardMarkup } from "../telegram/types"
import type { GatewayPermissionReply, GatewayPermissionRequest } from "./types"

type PermissionDetail = {
    label: string
    value: string
    code: boolean
}

type PermissionSummary = {
    description: string
    requestedPatterns: string[]
    alwaysPatterns: string[]
    details: PermissionDetail[]
}

const REJECT_WORDS = new Set(["/cancel", "cancel", "/reject", "reject"])
const ONCE_WORDS = new Set(["/once", "once"])
const ALWAYS_WORDS = new Set(["/always", "always"])
const PRIORITY_METADATA_KEYS = ["command", "path", "filePath", "cwd", "url", "pattern"] as const
const MAX_PATTERN_COUNT = 4
const MAX_DETAIL_COUNT = 6
const MAX_DETAIL_VALUE_LENGTH = 120

export type ParsedPermissionReply =
    | {
          kind: "reply"
          reply: GatewayPermissionReply
      }
    | {
          kind: "invalid"
          message: string
      }

export function formatPlainTextPermission(request: GatewayPermissionRequest): string {
    const summary = buildPermissionSummary(request)
    const lines = [
        "OpenCode needs approval before it can continue.",
        "",
        `Permission: ${request.permission}`,
        summary.description,
        "",
        ...formatPatternSection("Requested patterns:", summary.requestedPatterns),
    ]

    if (summary.alwaysPatterns.length > 0) {
        lines.push("", ...formatPatternSection('What "Always" will approve:', summary.alwaysPatterns))
    }

    if (summary.details.length > 0) {
        lines.push("", "Context:")
        lines.push(...summary.details.map((detail) => `- ${detail.label}: ${detail.value}`))
    }

    lines.push("", ...formatPermissionReplyInstructions(request))
    return lines.join("\n")
}

export function formatPermissionReplyError(request: GatewayPermissionRequest, message: string): string {
    return [message, "", ...formatPermissionReplyInstructions(request)].join("\n")
}

export function formatTelegramPermission(request: GatewayPermissionRequest): string {
    const summary = buildPermissionSummary(request)
    const lines = [
        "<b>OpenCode needs approval before it can continue.</b>",
        "",
        `<b>Permission:</b> <code>${escapeTelegramHtml(request.permission)}</code>`,
        escapeTelegramHtml(summary.description),
        "",
        "<b>Requested patterns</b>",
        ...summary.requestedPatterns.map((pattern) => `<code>${escapeTelegramHtml(pattern)}</code>`),
    ]

    if (summary.alwaysPatterns.length > 0) {
        lines.push("", '<b>What "Always" will approve</b>')
        lines.push(...summary.alwaysPatterns.map((pattern) => `<code>${escapeTelegramHtml(pattern)}</code>`))
    }

    if (summary.details.length > 0) {
        lines.push("", "<b>Context</b>")
        lines.push(
            ...summary.details.map((detail) =>
                detail.code
                    ? `<b>${escapeTelegramHtml(detail.label)}:</b> <code>${escapeTelegramHtml(detail.value)}</code>`
                    : `<b>${escapeTelegramHtml(detail.label)}:</b> ${escapeTelegramHtml(detail.value)}`,
            ),
        )
    }

    lines.push("", "Tap a button below or reply with text.")
    return lines.join("\n")
}

export function buildTelegramPermissionKeyboard(request: GatewayPermissionRequest): TelegramInlineKeyboardMarkup {
    const buttons = [
        {
            text: "Once",
            callback_data: "p:once",
        },
        ...(supportsAlwaysReply(request)
            ? [
                  {
                      text: "Always",
                      callback_data: "p:always",
                  },
              ]
            : []),
        {
            text: "Reject",
            callback_data: "p:reject",
        },
    ]

    return {
        inline_keyboard: [buttons],
    }
}

export function parsePermissionReply(request: GatewayPermissionRequest, text: string | null): ParsedPermissionReply {
    if (text === null) {
        return {
            kind: "invalid",
            message: "This permission request currently accepts text replies only.",
        }
    }

    const trimmed = text.trim().toLowerCase()
    if (trimmed.length === 0) {
        return {
            kind: "invalid",
            message: "Reply text must not be empty.",
        }
    }

    if (REJECT_WORDS.has(trimmed)) {
        return {
            kind: "reply",
            reply: "reject",
        }
    }

    if (ONCE_WORDS.has(trimmed)) {
        return {
            kind: "reply",
            reply: "once",
        }
    }

    if (ALWAYS_WORDS.has(trimmed)) {
        if (!supportsAlwaysReply(request)) {
            return {
                kind: "invalid",
                message: 'This request does not offer an "always" approval option.',
            }
        }

        return {
            kind: "reply",
            reply: "always",
        }
    }

    return {
        kind: "invalid",
        message: "Reply with /once, /always, or /reject.",
    }
}

export function resolvePermissionCallbackReply(
    data: string | null,
    request: GatewayPermissionRequest,
): GatewayPermissionReply | null {
    if (data === "p:once") {
        return "once"
    }

    if (data === "p:reject") {
        return "reject"
    }

    if (data === "p:always" && supportsAlwaysReply(request)) {
        return "always"
    }

    return null
}

export function formatPermissionCallbackAck(reply: GatewayPermissionReply): string {
    switch (reply) {
        case "once":
            return "Approved once."
        case "always":
            return "Approved for this OpenCode session."
        case "reject":
            return "Rejected."
    }
}

function supportsAlwaysReply(request: GatewayPermissionRequest): boolean {
    return request.always.length > 0
}

function formatPatternSection(title: string, patterns: string[]): string[] {
    return [title, ...patterns.map((pattern) => `- ${pattern}`)]
}

function formatPermissionReplyInstructions(request: GatewayPermissionRequest): string[] {
    const lines = ["How to reply:", "- Reply /once to approve this request."]

    if (supportsAlwaysReply(request)) {
        lines.push("- Reply /always to approve matching future requests for this OpenCode session.")
    }

    lines.push("- Reply /reject or /cancel to deny this request.")
    return lines
}

function buildPermissionSummary(request: GatewayPermissionRequest): PermissionSummary {
    const metadata = request.metadata
    const details: PermissionDetail[] = []
    const usedKeys = new Set<string>()

    for (const key of PRIORITY_METADATA_KEYS) {
        const value = toDisplayScalar(metadata[key])
        if (value === null) {
            continue
        }

        details.push({
            label: formatDetailLabel(key),
            value,
            code: key !== "pattern",
        })
        usedKeys.add(key)
    }

    for (const key of Object.keys(metadata).sort((left, right) => left.localeCompare(right))) {
        if (usedKeys.has(key)) {
            continue
        }

        const value = toDisplayScalar(metadata[key])
        if (value === null) {
            continue
        }

        details.push({
            label: formatDetailLabel(key),
            value,
            code: false,
        })
        usedKeys.add(key)
        if (details.length >= MAX_DETAIL_COUNT) {
            break
        }
    }

    if (request.tool !== null && details.length < MAX_DETAIL_COUNT) {
        details.push({
            label: "Tool call",
            value: `${request.tool.messageId}:${request.tool.callId}`,
            code: true,
        })
    }

    return {
        description: describePermission(request.permission),
        requestedPatterns: normalizePatterns(request.patterns),
        alwaysPatterns: normalizePatterns(request.always),
        details,
    }
}

function describePermission(permission: string): string {
    switch (permission) {
        case "external_directory":
            return "Access paths outside the current workspace."
        case "bash":
            return "Run a shell command."
        case "edit":
            return "Modify files."
        case "read":
            return "Read a file."
        case "list":
            return "List directory contents."
        case "glob":
            return "Run file globbing."
        case "grep":
            return "Run content search."
        case "task":
            return "Launch a subagent."
        case "skill":
            return "Load a skill."
        case "webfetch":
            return "Fetch a URL."
        case "websearch":
            return "Run a web search."
        case "codesearch":
            return "Run a code search."
        case "doom_loop":
            return "Repeat a previously blocked tool call."
        case "lsp":
            return "Run an LSP query."
        default:
            return "Approve or deny this action."
    }
}

function normalizePatterns(patterns: string[]): string[] {
    const visible = patterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
        .slice(0, MAX_PATTERN_COUNT)

    return visible.length === 0 ? ["(none)"] : visible
}

function toDisplayScalar(value: unknown): string | null {
    if (typeof value === "string") {
        return truncateDetailValue(value)
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }

    return null
}

function truncateDetailValue(value: string): string {
    const normalized = value.trim()
    if (normalized.length <= MAX_DETAIL_VALUE_LENGTH) {
        return normalized
    }

    return `${normalized.slice(0, MAX_DETAIL_VALUE_LENGTH - 3)}...`
}

function formatDetailLabel(value: string): string {
    switch (value) {
        case "filePath":
            return "File path"
        default:
            return value
                .replace(/([a-z])([A-Z])/gu, "$1 $2")
                .replaceAll("_", " ")
                .replace(/\b\w/gu, (match) => match.toUpperCase())
    }
}
