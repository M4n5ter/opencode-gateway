import type {
    BindingOpencodeCommand,
    BindingOpencodeCommandResult,
    BindingPromptPart,
    GatewayBindingModule,
    OpencodeExecutionDriver,
} from "../binding"
import type { TextDeliverySession } from "../delivery/text"
import type { OpencodeSdkAdapter } from "../opencode/adapter"
import type { OpencodeEventHub } from "../opencode/events"
import type { ExecutionBudget } from "./execution-budget"
import { isTimeoutCommandResult, OpencodeCommandTimeoutError, timeoutStageForCommand } from "./opencode-timeout"

const DEFAULT_FLUSH_INTERVAL_MS = 400

export type OpencodeDriverPrompt = {
    promptKey: string
    parts: BindingPromptPart[]
}

export type PromptExecutionResult = {
    sessionId: string
    responseText: string
    finalText: string | null
}

type GatewayOpencodeRuntimeLike = Pick<OpencodeSdkAdapter, "execute">
type TextDeliverySessionLike = Pick<TextDeliverySession, "mode" | "preview">
type DriverRegistrationLike = ReturnType<OpencodeEventHub["registerDriver"]>

export async function runOpencodeDriver(options: {
    module: GatewayBindingModule
    opencode: GatewayOpencodeRuntimeLike
    events: OpencodeEventHub
    conversationKey: string
    persistedSessionId: string | null
    deliverySession: TextDeliverySessionLike | null
    prompts: OpencodeDriverPrompt[]
    onSessionAvailable?: (sessionId: string) => Promise<void> | void
    onCommand?: (command: BindingOpencodeCommand) => Promise<void> | void
    shouldInterrupt?: () => boolean
    budget: ExecutionBudget
}): Promise<PromptExecutionResult> {
    const driver = new options.module.OpencodeExecutionDriver({
        conversationKey: options.conversationKey,
        persistedSessionId: options.persistedSessionId,
        mode: options.deliverySession?.mode === "progressive" ? "progressive" : "oneshot",
        flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
        prompts: options.prompts,
    })
    let registration: DriverRegistrationLike | null = null
    let activeSessionId: string | null = null

    try {
        let step = driver.start()
        for (;;) {
            if (step.kind === "command") {
                const command = step.command
                if (options.shouldInterrupt?.() === true) {
                    throw new OpencodeDriverInterruptedError()
                }
                options.budget.throwIfHardTimedOut(`executing ${step.command.kind}`)
                await options.onCommand?.(command)
                activeSessionId = await syncSessionContext(activeSessionId, command, options.onSessionAvailable)
                registration = syncDriverRegistration(registration, command, driver, options)
                const result = await options.opencode.execute(options.budget.applyToCommand(command))
                if (options.shouldInterrupt?.() === true) {
                    throw new OpencodeDriverInterruptedError()
                }
                activeSessionId = await syncSessionContext(activeSessionId, result, options.onSessionAvailable)
                registration = syncDriverRegistration(registration, result, driver, options)
                if (isTimeoutCommandResult(result)) {
                    throw new OpencodeCommandTimeoutError(
                        timeoutStageForCommand(command),
                        result.message,
                        result.sessionId,
                    )
                }
                step = driver.resume(result)
                continue
            }

            if (step.kind === "complete") {
                return {
                    sessionId: step.sessionId,
                    responseText: step.responseText,
                    finalText: step.finalText,
                }
            }

            throw new Error(step.message)
        }
    } finally {
        registration?.dispose()
        driver.free?.()
    }
}

class OpencodeDriverInterruptedError extends Error {
    constructor() {
        super("OpenCode driver interrupted")
        this.name = "OpencodeDriverInterruptedError"
    }
}

async function syncSessionContext(
    currentSessionId: string | null,
    value: BindingOpencodeCommand | BindingOpencodeCommandResult,
    onSessionAvailable: ((sessionId: string) => Promise<void> | void) | undefined,
): Promise<string | null> {
    const sessionId = sessionIdFromCommandOrResult(value)
    if (sessionId === null || sessionId === currentSessionId) {
        return currentSessionId
    }

    await onSessionAvailable?.(sessionId)
    return sessionId
}

function syncDriverRegistration(
    registration: DriverRegistrationLike | null,
    value: BindingOpencodeCommand | BindingOpencodeCommandResult,
    driver: OpencodeExecutionDriver,
    options: {
        events: OpencodeEventHub
        deliverySession: TextDeliverySessionLike | null
    },
): DriverRegistrationLike | null {
    const sessionId = sessionIdFromCommandOrResult(value)
    if (sessionId === null) {
        return registration
    }

    if (registration !== null) {
        registration.updateSession(sessionId)
        return registration
    }

    const deliverySession = options.deliverySession
    return options.events.registerDriver(sessionId, driver, async (snapshot) => {
        if (deliverySession?.mode !== "progressive") {
            return
        }

        await deliverySession.preview(snapshot)
    })
}

function sessionIdFromCommandOrResult(value: BindingOpencodeCommand | BindingOpencodeCommandResult): string | null {
    switch (value.kind) {
        case "lookupSession":
        case "waitUntilIdle":
        case "appendPrompt":
        case "sendPromptAsync":
        case "awaitPromptResponse":
        case "readMessage":
        case "listMessages":
            return value.sessionId
        case "createSession":
            return "sessionId" in value ? value.sessionId : null
        case "error":
            return value.sessionId
    }
}
