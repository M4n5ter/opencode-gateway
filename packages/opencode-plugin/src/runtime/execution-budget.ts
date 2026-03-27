import type { BindingOpencodeCommand } from "../binding"
import type { GatewayExecutionConfig } from "../config/gateway"

const DEFAULT_SDK_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_PROMPT_SETTLE_MS = 1_000

export class ExecutionBudget {
    private readonly startedAtMs: number
    private readonly hardDeadlineMs: number | null

    constructor(
        private readonly config: GatewayExecutionConfig,
        startedAtMs = Date.now(),
    ) {
        this.startedAtMs = startedAtMs
        this.hardDeadlineMs = config.hardTimeoutMs === null ? null : this.startedAtMs + config.hardTimeoutMs
    }

    applyToCommand(command: BindingOpencodeCommand): BindingOpencodeCommand {
        switch (command.kind) {
            case "waitUntilIdle":
                return {
                    ...command,
                    timeoutMs: this.clampToHardDeadline(command.timeoutMs ?? this.config.sessionWaitTimeoutMs),
                }
            case "awaitPromptResponse":
                return {
                    ...command,
                    progressTimeoutMs: this.clampToHardDeadline(
                        command.progressTimeoutMs ?? this.config.promptProgressTimeoutMs,
                    ),
                    hardTimeoutMs: this.remainingHardTimeoutMs(),
                    settleMs: command.settleMs ?? DEFAULT_PROMPT_SETTLE_MS,
                }
            default:
                return command
        }
    }

    remainingHardTimeoutMs(): number | null {
        if (this.hardDeadlineMs === null) {
            return null
        }

        return Math.max(0, this.hardDeadlineMs - Date.now())
    }

    nextSdkRequestTimeoutMs(preferredMs = DEFAULT_SDK_REQUEST_TIMEOUT_MS): number {
        return this.clampToHardDeadline(preferredMs)
    }

    sessionWaitTimeoutMs(): number {
        return this.clampToHardDeadline(this.config.sessionWaitTimeoutMs)
    }

    abortSettleTimeoutMs(): number {
        return Math.min(
            this.config.abortSettleTimeoutMs,
            this.nextSdkRequestTimeoutMs(this.config.abortSettleTimeoutMs),
        )
    }

    throwIfHardTimedOut(stage: string): void {
        if (this.hardDeadlineMs !== null && Date.now() >= this.hardDeadlineMs) {
            throw new ExecutionHardTimeoutError(`execution exceeded hard timeout while ${stage}`)
        }
    }

    private clampToHardDeadline(timeoutMs: number): number {
        const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, "timeoutMs")
        const remainingHardTimeoutMs = this.remainingHardTimeoutMs()
        if (remainingHardTimeoutMs === null) {
            return normalizedTimeoutMs
        }

        if (remainingHardTimeoutMs <= 0) {
            throw new ExecutionHardTimeoutError("execution exceeded hard timeout")
        }

        return Math.max(1, Math.min(normalizedTimeoutMs, remainingHardTimeoutMs))
    }
}

export class ExecutionHardTimeoutError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ExecutionHardTimeoutError"
    }
}

function normalizePositiveInteger(value: number, field: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${field} must be a positive integer`)
    }

    return value
}
