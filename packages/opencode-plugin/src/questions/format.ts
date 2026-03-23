import type { GatewayQuestionInfo, GatewayQuestionRequest } from "./types"

export function formatPlainTextQuestion(request: GatewayQuestionRequest): string {
    return [
        "OpenCode needs additional input before it can continue.",
        "",
        ...request.questions.flatMap((question, index) => formatQuestionBlock(question, index)),
        formatReplyInstructions(request.questions),
    ].join("\n")
}

export function formatQuestionReplyError(request: GatewayQuestionRequest, message: string): string {
    return [message, "", formatReplyInstructions(request.questions)].join("\n")
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

function formatReplyInstructions(questions: GatewayQuestionInfo[]): string {
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
