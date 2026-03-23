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
