import { loadGatewayBindingModule } from "../packages/opencode-plugin/src/binding"

const module = await loadGatewayBindingModule()
if (typeof module.gatewayStatus !== "function") {
    throw new Error("gatewayStatus export is unavailable")
}
if (typeof module.nextCronRunAt !== "function") {
    throw new Error("nextCronRunAt export is unavailable")
}
if (typeof module.normalizeCronTimeZone !== "function") {
    throw new Error("normalizeCronTimeZone export is unavailable")
}
if (typeof module.prepareInboundExecution !== "function") {
    throw new Error("prepareInboundExecution export is unavailable")
}
if (typeof module.OpencodeExecutionDriver !== "function") {
    throw new Error("OpencodeExecutionDriver constructor is unavailable")
}

module.gatewayStatus()
module.normalizeCronTimeZone("Asia/Shanghai")
module.nextCronRunAt(
    {
        id: "nightly",
        schedule: "0 9 * * *",
        prompt: "Summarize work",
        deliveryChannel: null,
        deliveryTarget: null,
        deliveryTopic: null,
    },
    1_735_689_600_000,
    "UTC",
)
const prepared = module.prepareInboundExecution({
    deliveryTarget: {
        channel: "telegram",
        target: "42",
        topic: null,
    },
    sender: "telegram:7",
    body: "hello",
})
const driver = new module.OpencodeExecutionDriver({
    conversationKey: prepared.conversationKey,
    persistedSessionId: null,
    mode: "progressive",
    flushIntervalMs: 400,
    prompts: [{ promptKey: "synthetic:smoke:0", prompt: prepared.prompt }],
})
const firstStep = driver.start()
if (firstStep.kind !== "command" || firstStep.command.kind !== "createSession") {
    throw new Error("driver did not request createSession")
}

const createResult = {
    kind: "createSession",
    sessionId: "session-smoke",
}
const idleBeforePrompt = driver.resume(createResult)
if (idleBeforePrompt.kind !== "command" || idleBeforePrompt.command.kind !== "waitUntilIdle") {
    throw new Error("driver did not wait for idle before prompt dispatch")
}

const sendPrompt = driver.resume({
    kind: "waitUntilIdle",
    sessionId: "session-smoke",
})
if (sendPrompt.kind !== "command" || sendPrompt.command.kind !== "sendPromptAsync") {
    throw new Error("driver did not issue sendPromptAsync")
}

const awaitPromptResponse = driver.resume({
    kind: "sendPromptAsync",
    sessionId: "session-smoke",
})
if (awaitPromptResponse.kind !== "command" || awaitPromptResponse.command.kind !== "awaitPromptResponse") {
    throw new Error("driver did not await the prompt response after sendPromptAsync")
}

const completed = driver.resume({
    kind: "awaitPromptResponse",
    sessionId: "session-smoke",
    messageId: "msg_assistant_smoke",
    parts: [
        {
            messageId: "msg_assistant_smoke",
            partId: "prt_assistant_smoke",
            type: "text",
            text: null,
            ignored: false,
        },
    ],
})
if (completed.kind !== "complete") {
    throw new Error("driver did not complete after awaitPromptResponse")
}
if (completed.finalText !== null) {
    throw new Error(`driver finalText must serialize as null, received ${String(completed.finalText)}`)
}
