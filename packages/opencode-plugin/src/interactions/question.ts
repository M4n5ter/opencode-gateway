import type { TelegramInlineKeyboardMarkup } from "../telegram/types"
import type { GatewayQuestionInfo, GatewayQuestionRequest } from "./types"

export type ParsedQuestionReply =
    | {
          kind: "reply"
          answers: string[][]
      }
    | {
          kind: "reject"
      }
    | {
          kind: "invalid"
          message: string
      }

const CANCEL_WORDS = new Set(["/cancel", "cancel", "/reject", "reject"])

export function formatPlainTextQuestion(request: GatewayQuestionRequest): string {
    return [
        "OpenCode needs additional input before it can continue.",
        "",
        ...request.questions.flatMap((question, index) => formatQuestionBlock(question, index)),
        formatQuestionReplyInstructions(request.questions),
    ].join("\n")
}

export function formatQuestionReplyError(request: GatewayQuestionRequest, message: string): string {
    return [message, "", formatQuestionReplyInstructions(request.questions)].join("\n")
}

export function parseQuestionReply(request: GatewayQuestionRequest, text: string | null): ParsedQuestionReply {
    if (text === null) {
        return {
            kind: "invalid",
            message: "This question currently accepts text replies only.",
        }
    }

    const trimmed = text.trim()
    if (trimmed.length === 0) {
        return {
            kind: "invalid",
            message: "Reply text must not be empty.",
        }
    }

    if (CANCEL_WORDS.has(trimmed.toLowerCase())) {
        return {
            kind: "reject",
        }
    }

    if (request.questions.length === 1) {
        const parsedAnswer = parseQuestionLine(request.questions[0], trimmed)
        return parsedAnswer.kind === "invalid"
            ? parsedAnswer
            : {
                  kind: "reply",
                  answers: [parsedAnswer.answer],
              }
    }

    const lines = trimmed
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    if (lines.length !== request.questions.length) {
        return {
            kind: "invalid",
            message: `Expected ${request.questions.length} non-empty lines, but received ${lines.length}.`,
        }
    }

    const answers: string[][] = []
    for (const [index, question] of request.questions.entries()) {
        const parsedAnswer = parseQuestionLine(question, lines[index])
        if (parsedAnswer.kind === "invalid") {
            return parsedAnswer
        }

        answers.push(parsedAnswer.answer)
    }

    return {
        kind: "reply",
        answers,
    }
}

export function buildTelegramQuestionKeyboard(request: GatewayQuestionRequest): TelegramInlineKeyboardMarkup | null {
    if (request.questions.length !== 1) {
        return null
    }

    const [question] = request.questions
    if (question.multiple || question.options.length === 0) {
        return null
    }

    return {
        inline_keyboard: question.options.map((option, index) => [
            {
                text: option.label,
                callback_data: `q:${index}`,
            },
        ]),
    }
}

export function formatTelegramQuestion(request: GatewayQuestionRequest): string {
    const [question] = request.questions
    return [
        "OpenCode needs additional input before it can continue.",
        "",
        `${question.header}: ${question.question}`,
        "",
        "Tap a button below or reply with text.",
    ].join("\n")
}

export function resolveQuestionCallbackAnswer(data: string | null, request: GatewayQuestionRequest): string | null {
    if (data === null || !data.startsWith("q:") || request.questions.length !== 1) {
        return null
    }

    const indexText = data.slice(2)
    const index = Number.parseInt(indexText, 10)
    if (!Number.isSafeInteger(index) || index < 0) {
        return null
    }

    return request.questions[0]?.options[index]?.label ?? null
}

function formatQuestionBlock(question: GatewayQuestionInfo, index: number): string[] {
    const label = `Question ${index + 1}: ${question.header}`
    const options =
        question.options.length === 0
            ? []
            : [
                  "Options:",
                  ...question.options.map(
                      (option, optionIndex) => `${optionIndex + 1}. ${option.label} - ${option.description}`,
                  ),
              ]

    return [label, question.question, ...options, ""]
}

function formatQuestionReplyInstructions(questions: GatewayQuestionInfo[]): string {
    if (questions.length === 1) {
        const question = questions[0]
        const selectionHint = question.multiple
            ? "Reply with one line. You may send option numbers or labels separated by commas."
            : "Reply with one line. You may send an option number, an option label, or custom text."

        return ["How to reply:", `- ${selectionHint}`, "- Reply /cancel to reject this question."].join("\n")
    }

    return [
        "How to reply:",
        "- Reply with one non-empty line per question, in order.",
        "- Each line may use option numbers, option labels, or custom text when allowed.",
        "- Reply /cancel to reject this question.",
    ].join("\n")
}

function parseQuestionLine(
    question: GatewayQuestionInfo,
    line: string,
):
    | {
          kind: "answer"
          answer: string[]
      }
    | {
          kind: "invalid"
          message: string
      } {
    const rawSelections = question.multiple
        ? line
              .split(/[,\n]/u)
              .map((token) => token.trim())
              .filter((token) => token.length > 0)
        : [line]

    if (rawSelections.length === 0) {
        return {
            kind: "invalid",
            message: "At least one answer is required.",
        }
    }

    const answers: string[] = []
    for (const rawSelection of rawSelections) {
        const option = resolveOptionSelection(question, rawSelection)
        if (option !== null) {
            answers.push(option)
            continue
        }

        if (!question.custom) {
            return {
                kind: "invalid",
                message: `Answer "${rawSelection}" does not match any allowed option.`,
            }
        }

        answers.push(rawSelection)
    }

    return {
        kind: "answer",
        answer: answers,
    }
}

function resolveOptionSelection(question: GatewayQuestionInfo, selection: string): string | null {
    if (question.options.length === 0) {
        return null
    }

    const numericIndex = Number.parseInt(selection, 10)
    if (Number.isSafeInteger(numericIndex) && String(numericIndex) === selection && numericIndex >= 1) {
        return question.options[numericIndex - 1]?.label ?? null
    }

    const normalized = selection.toLowerCase()
    return question.options.find((option) => option.label.toLowerCase() === normalized)?.label ?? null
}
