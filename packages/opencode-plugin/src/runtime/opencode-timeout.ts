import type { BindingOpencodeCommand, BindingOpencodeCommandResult } from "../binding"

export type OpencodeTimeoutStage = "session_wait" | "prompt_progress" | "hard_timeout" | "command"
type TimeoutCommandResult = Extract<BindingOpencodeCommandResult, { kind: "error" }> & {
    code: "timeout"
}

export class OpencodeCommandTimeoutError extends Error {
    constructor(
        readonly stage: OpencodeTimeoutStage,
        message: string,
        readonly sessionId: string | null,
    ) {
        super(message)
        this.name = "OpencodeCommandTimeoutError"
    }
}

export function timeoutStageForCommand(command: BindingOpencodeCommand): OpencodeTimeoutStage {
    switch (command.kind) {
        case "waitUntilIdle":
            return "session_wait"
        case "awaitPromptResponse":
            return "prompt_progress"
        default:
            return "command"
    }
}

export function isTimeoutCommandResult(result: BindingOpencodeCommandResult): result is TimeoutCommandResult {
    return result.kind === "error" && result.code === "timeout"
}
