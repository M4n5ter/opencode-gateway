import { expect, test } from "bun:test"

import type {
    BindingExecutionObservation,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingOpencodeCommand,
    BindingOpencodeCommandPart,
    BindingOpencodeCommandResult,
    BindingPreparedExecution,
    BindingProgressiveDirective,
    BindingPromptPart,
} from "../binding"
import { OpencodeEventHub } from "../opencode/events"
import { migrateGatewayDatabase } from "../store/migrations"
import type { MailboxEntryRecord } from "../store/sqlite"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayExecutor } from "./executor"

test("GatewayExecutor recreates a stale persisted session before completing a oneshot reply", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_stale", 0)
        const events = new OpencodeEventHub()

        const deliveredBodies: Array<string | null> = []
        const commands: BindingOpencodeCommand[] = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "lookupSession":
                            return { kind: "lookupSession", sessionId: command.sessionId, found: false }
                        case "createSession":
                            return { kind: "createSession", sessionId: "ses_fresh" }
                        case "sendPromptAsync":
                            events.handleEvent(
                                createAssistantMessageUpdatedEvent(
                                    command.sessionId,
                                    "msg_assistant_final",
                                    command.messageId,
                                ),
                            )
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_final",
                                "hello back",
                            )
                        case "appendPrompt":
                            throw new Error("unused")
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return false
                },
                async abortSession(): Promise<void> {},
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(finalText: string | null): Promise<boolean> {
                                deliveredBodies.push(finalText)
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.handleInboundMessage(createMessage())

        expect(commands.map((command) => command.kind)).toEqual([
            "lookupSession",
            "createSession",
            "waitUntilIdle",
            "sendPromptAsync",
            "awaitPromptResponse",
        ])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_fresh")
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
        expect(report.delivered).toBe(true)
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor appends earlier prompts and forwards progressive previews for the final prompt", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const previewSnapshots: Array<{ processText: string | null; answerText: string | null }> = []
        const deliveredBodies: Array<string | null> = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "createSession":
                            return { kind: "createSession", sessionId: "ses_fresh" }
                        case "appendPrompt":
                            return { kind: "appendPrompt", sessionId: command.sessionId }
                        case "sendPromptAsync":
                            events.handleEvent(
                                createTextPartUpdatedEvent(
                                    command.sessionId,
                                    "msg_assistant_preview",
                                    "part-1",
                                    "preview",
                                ),
                            )
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_preview",
                                "hello back",
                            )
                        case "lookupSession":
                            throw new Error("unused")
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return false
                },
                async abortSession(): Promise<void> {},
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "progressive" as const,
                            async preview(preview): Promise<void> {
                                previewSnapshots.push(preview)
                            },
                            async finish(finalText: string | null): Promise<boolean> {
                                deliveredBodies.push(finalText)
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        const report = await executor.executeMailboxEntries([
            createMailboxEntry(1, "first"),
            createMailboxEntry(2, "second"),
        ])

        expect(
            commands.map((command) => {
                switch (command.kind) {
                    case "appendPrompt":
                    case "sendPromptAsync":
                        return { kind: command.kind, parts: command.parts, messageId: command.messageId }
                    case "awaitPromptResponse":
                        return { kind: command.kind, messageId: command.messageId }
                    default:
                        return { kind: command.kind }
                }
            }),
        ).toEqual([
            { kind: "createSession" },
            { kind: "waitUntilIdle" },
            {
                kind: "appendPrompt",
                parts: createTextCommandParts(`mailbox:1:${now}`, "first"),
                messageId: `msg_gateway_mailbox_1_${now}`,
            },
            {
                kind: "sendPromptAsync",
                parts: createTextCommandParts(`mailbox:2:${now}`, "second"),
                messageId: `msg_gateway_mailbox_2_${now}`,
            },
            { kind: "awaitPromptResponse", messageId: `msg_gateway_mailbox_2_${now}` },
        ])
        expect(previewSnapshots).toEqual([
            {
                processText: null,
                answerText: "preview",
            },
        ])
        expect(deliveredBodies).toEqual(["hello back"])
        expect(report.responseText).toBe("hello back")
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor preserves a session binding that changed during execution", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_old", 0)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "lookupSession":
                            return { kind: "lookupSession", sessionId: command.sessionId, found: true }
                        case "sendPromptAsync":
                            store.putSessionBinding("telegram:42", "ses_switched", now + 1)
                            events.handleEvent(
                                createAssistantMessageUpdatedEvent(
                                    command.sessionId,
                                    "msg_assistant_final",
                                    command.messageId,
                                ),
                            )
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_final",
                                "hello back",
                            )
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                        case "appendPrompt":
                        case "createSession":
                            throw new Error("unused")
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return false
                },
                async abortSession(): Promise<void> {},
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(): Promise<boolean> {
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        await executor.handleInboundMessage(createMessage())

        expect(commands.map((command) => command.kind)).toEqual([
            "lookupSession",
            "lookupSession",
            "waitUntilIdle",
            "sendPromptAsync",
            "awaitPromptResponse",
        ])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_switched")
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor appends context into the target conversation without triggering delivery", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "createSession":
                            return { kind: "createSession", sessionId: "ses_context" }
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                        case "appendPrompt":
                            return { kind: "appendPrompt", sessionId: command.sessionId }
                        case "lookupSession":
                        case "sendPromptAsync":
                        case "awaitPromptResponse":
                            throw new Error("unused")
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return false
                },
                async abortSession(): Promise<void> {},
            },
            events,
            {
                async openMany() {
                    throw new Error("unused")
                },
            },
            new MemoryLogger(),
        )

        await executor.appendContextToConversation({
            conversationKey: "telegram:42",
            replyTarget: {
                channel: "telegram",
                target: "42",
                topic: null,
            },
            body: "schedule result",
            recordedAtMs: now,
        })

        expect(commands).toEqual([
            {
                kind: "createSession",
                title: "Gateway telegram:42",
            },
            {
                kind: "waitUntilIdle",
                sessionId: "ses_context",
            },
            {
                kind: "appendPrompt",
                sessionId: "ses_context",
                messageId: `msg_gateway_context_${now}_0`,
                parts: [
                    {
                        kind: "text",
                        partId: `prt_gateway_context_${now}_0_0`,
                        text: "schedule result",
                    },
                ],
            },
        ])
        expect(store.getSessionBinding("telegram:42")).toBe("ses_context")
        expect(store.getDefaultSessionReplyTarget("ses_context")).toEqual({
            channel: "telegram",
            target: "42",
            topic: null,
        })
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor aborts a residual busy persisted session before dispatching the next prompt", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("telegram:42", "ses_busy", 0)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const abortCalls: string[] = []
        const busyStates = [true, false, false]
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "lookupSession":
                            return { kind: "lookupSession", sessionId: command.sessionId, found: true }
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                        case "sendPromptAsync":
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_final",
                                "hello back",
                            )
                        case "appendPrompt":
                        case "createSession":
                            throw new Error("unused")
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return busyStates.shift() ?? false
                },
                async abortSession(sessionId: string): Promise<void> {
                    abortCalls.push(sessionId)
                },
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(): Promise<boolean> {
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        await executor.handleInboundMessage(createMessage())

        expect(abortCalls).toEqual(["ses_busy"])
        expect(commands.map((command) => command.kind)).toEqual([
            "lookupSession",
            "lookupSession",
            "waitUntilIdle",
            "sendPromptAsync",
            "awaitPromptResponse",
        ])
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor aborts a residual busy session after prompt completion", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const abortCalls: string[] = []
        const busyStates = [true, true, true, true, false]
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "createSession":
                            return { kind: "createSession", sessionId: "ses_fresh" }
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                        case "sendPromptAsync":
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_final",
                                "hello back",
                            )
                        case "lookupSession":
                        case "appendPrompt":
                            throw new Error("unused")
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return busyStates.shift() ?? false
                },
                async abortSession(sessionId: string): Promise<void> {
                    abortCalls.push(sessionId)
                },
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(): Promise<boolean> {
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        await executor.handleInboundMessage(createMessage())

        expect(abortCalls).toEqual(["ses_fresh"])
        expect(commands.map((command) => command.kind)).toEqual([
            "createSession",
            "waitUntilIdle",
            "sendPromptAsync",
            "awaitPromptResponse",
        ])
    } finally {
        restoreNow()
        db.close()
    }
})

test("GatewayExecutor lets a residual busy session settle before aborting it", async () => {
    const db = createMemoryDatabase()
    const now = 1_735_689_600_000
    const restoreNow = mockDateNow(now)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const events = new OpencodeEventHub()

        const commands: BindingOpencodeCommand[] = []
        const abortCalls: string[] = []
        const busyStates = [true, true, false]
        const executor = new GatewayExecutor(
            createModule(),
            store,
            {
                async execute(command: BindingOpencodeCommand): Promise<BindingOpencodeCommandResult> {
                    commands.push(command)

                    switch (command.kind) {
                        case "createSession":
                            return { kind: "createSession", sessionId: "ses_fresh" }
                        case "waitUntilIdle":
                            return { kind: "waitUntilIdle", sessionId: command.sessionId }
                        case "sendPromptAsync":
                            return { kind: "sendPromptAsync", sessionId: command.sessionId }
                        case "awaitPromptResponse":
                            return createAwaitPromptResponseResult(
                                command.sessionId,
                                "msg_assistant_final",
                                "hello back",
                            )
                        case "lookupSession":
                        case "appendPrompt":
                            throw new Error("unused")
                    }

                    throw new Error(`unexpected command: ${command.kind}`)
                },
                async isSessionBusy() {
                    return busyStates.shift() ?? false
                },
                async abortSession(sessionId: string): Promise<void> {
                    abortCalls.push(sessionId)
                },
            },
            events,
            {
                async openMany() {
                    return [
                        {
                            mode: "oneshot" as const,
                            async preview(): Promise<void> {},
                            async finish(): Promise<boolean> {
                                return true
                            },
                        },
                    ]
                },
            },
            new MemoryLogger(),
        )

        await executor.handleInboundMessage(createMessage())

        expect(abortCalls).toEqual([])
        expect(commands.map((command) => command.kind)).toEqual([
            "createSession",
            "waitUntilIdle",
            "sendPromptAsync",
            "awaitPromptResponse",
        ])
    } finally {
        restoreNow()
        db.close()
    }
})

function createMessage(): BindingInboundMessage {
    return {
        sender: "telegram:7",
        text: "hello",
        attachments: [],
        deliveryTarget: {
            channel: "telegram",
            target: "42",
            topic: null,
        },
    }
}

function createMailboxEntry(id: number, text: string): MailboxEntryRecord {
    return {
        id,
        mailboxKey: "telegram:42",
        sourceKind: "telegram_update",
        externalId: `update:${id}`,
        sender: "telegram:7",
        text,
        attachments: [],
        replyChannel: "telegram",
        replyTarget: "42",
        replyTopic: null,
        createdAtMs: 1_000 + id,
    }
}

function createModule() {
    return {
        gatewayStatus() {
            return {
                runtimeMode: "contract",
                supportsTelegram: true,
                supportsCron: true,
                hasWebUi: false,
            }
        },
        conversationKeyForDeliveryTarget(target: { channel: string; target: string; topic: string | null }) {
            return target.topic === null
                ? `${target.channel}:${target.target}`
                : `${target.channel}:${target.target}:topic:${target.topic}`
        },
        nextCronRunAt() {
            return 1_735_722_000_000
        },
        normalizeCronTimeZone(timeZone: string) {
            return timeZone.trim()
        },
        prepareInboundExecution(message: BindingInboundMessage): BindingPreparedExecution {
            return {
                conversationKey: `telegram:${message.deliveryTarget.target}`,
                promptParts: createTextPromptParts(message.text ?? ""),
                replyTarget: message.deliveryTarget,
            }
        },
        prepareCronExecution() {
            throw new Error("unused")
        },
        OpencodeExecutionDriver: FakeOpencodeExecutionDriver,
    }
}

class FakeOpencodeExecutionDriver {
    private readonly prompts: Array<{ promptKey: string; parts: BindingPromptPart[] }>
    private readonly persistedSessionId: string | null
    private sessionId: string | null = null
    private phase:
        | "initial"
        | "awaitingLookup"
        | "awaitingCreate"
        | "awaitingPreflightWait"
        | "awaitingAppend"
        | "awaitingSendAsync"
        | "awaitingPromptResponse"
        | "done" = "initial"
    private appendIndex = 0
    constructor(input: {
        prompts: Array<{ promptKey: string; parts: BindingPromptPart[] }>
        persistedSessionId: string | null
    }) {
        this.prompts = input.prompts
        this.persistedSessionId = input.persistedSessionId
    }

    start() {
        if (this.persistedSessionId !== null) {
            this.phase = "awaitingLookup"
            return {
                kind: "command" as const,
                command: {
                    kind: "lookupSession" as const,
                    sessionId: this.persistedSessionId,
                },
            }
        }

        this.phase = "awaitingCreate"
        return {
            kind: "command" as const,
            command: {
                kind: "createSession" as const,
                title: "Gateway telegram:42",
            },
        }
    }

    resume(result: BindingOpencodeCommandResult) {
        switch (this.phase) {
            case "awaitingLookup":
                if (result.kind !== "lookupSession") {
                    throw new Error("unexpected lookup result")
                }
                if (result.found) {
                    this.sessionId = result.sessionId
                    this.phase = "awaitingPreflightWait"
                    return createWaitUntilIdleCommand(result.sessionId)
                }

                this.phase = "awaitingCreate"
                return createSessionCommand()
            case "awaitingCreate":
                if (result.kind !== "createSession") {
                    throw new Error("unexpected create result")
                }
                this.sessionId = result.sessionId
                this.phase = "awaitingPreflightWait"
                return createWaitUntilIdleCommand(result.sessionId)
            case "awaitingPreflightWait":
                if (result.kind !== "waitUntilIdle" || this.sessionId === null) {
                    throw new Error("unexpected wait result")
                }
                if (this.prompts.length > 1) {
                    this.phase = "awaitingAppend"
                    return {
                        kind: "command" as const,
                        command: createAppendCommand(this.sessionId, this.promptAt(this.appendIndex)),
                    }
                }

                this.phase = "awaitingSendAsync"
                return {
                    kind: "command" as const,
                    command: createSendPromptAsyncCommand(this.sessionId, this.promptAt(this.prompts.length - 1)),
                }
            case "awaitingAppend":
                if (result.kind !== "appendPrompt" || this.sessionId === null) {
                    throw new Error("unexpected append result")
                }
                this.appendIndex += 1
                this.phase = "awaitingSendAsync"
                return {
                    kind: "command" as const,
                    command: createSendPromptAsyncCommand(this.sessionId, this.promptAt(this.appendIndex)),
                }
            case "awaitingSendAsync":
                if (result.kind !== "sendPromptAsync" || this.sessionId === null) {
                    throw new Error("unexpected send result")
                }
                this.phase = "awaitingPromptResponse"
                return {
                    kind: "command" as const,
                    command: {
                        kind: "awaitPromptResponse" as const,
                        sessionId: this.sessionId,
                        messageId: createPromptMessageId(this.promptAt(this.appendIndex)),
                    },
                }
            case "awaitingPromptResponse":
                if (result.kind !== "awaitPromptResponse" || this.sessionId === null) {
                    throw new Error("unexpected prompt response result")
                }
                this.phase = "done"
                return {
                    kind: "complete" as const,
                    sessionId: this.sessionId,
                    responseText: renderVisibleText(result.parts, result.messageId),
                    finalText: renderVisibleText(result.parts, result.messageId),
                }
            case "initial":
            case "done":
                throw new Error(`unexpected driver phase: ${this.phase}`)
        }
    }

    observeEvent(observation: BindingExecutionObservation): BindingProgressiveDirective {
        if (observation.kind === "textPartUpdated" && observation.text !== null) {
            return {
                kind: "preview",
                processText: null,
                answerText: observation.text,
            }
        }

        return {
            kind: "noop",
        }
    }

    private promptAt(index: number) {
        const prompt = this.prompts[index]
        if (!prompt) {
            throw new Error(`missing prompt at index ${index}`)
        }

        return prompt
    }
}

function createSessionCommand() {
    return {
        kind: "command" as const,
        command: {
            kind: "createSession" as const,
            title: "Gateway telegram:42",
        },
    }
}

function createWaitUntilIdleCommand(sessionId: string) {
    return {
        kind: "command" as const,
        command: {
            kind: "waitUntilIdle" as const,
            sessionId,
        },
    }
}

function createAppendCommand(sessionId: string, prompt: { promptKey: string; parts: BindingPromptPart[] }) {
    return {
        kind: "appendPrompt" as const,
        sessionId,
        messageId: `msg_gateway_${prompt.promptKey.replaceAll(":", "_")}`,
        parts: toCommandParts(prompt),
    }
}

function createSendPromptAsyncCommand(sessionId: string, prompt: { promptKey: string; parts: BindingPromptPart[] }) {
    return {
        kind: "sendPromptAsync" as const,
        sessionId,
        messageId: createPromptMessageId(prompt),
        parts: toCommandParts(prompt),
    }
}

function createPromptMessageId(prompt: { promptKey: string }) {
    return `msg_gateway_${prompt.promptKey.replaceAll(":", "_")}`
}

function createTextPromptParts(text: string): BindingPromptPart[] {
    return [{ kind: "text", text }]
}

function createTextCommandParts(promptKey: string, text: string): BindingOpencodeCommandPart[] {
    return [{ kind: "text", partId: `prt_gateway_${promptKey.replaceAll(":", "_")}_0`, text }]
}

function toCommandParts(prompt: { promptKey: string; parts: BindingPromptPart[] }): BindingOpencodeCommandPart[] {
    return prompt.parts.map((part, index) => {
        if (part.kind === "text") {
            return {
                kind: "text",
                partId: `prt_gateway_${prompt.promptKey.replaceAll(":", "_")}_${index}`,
                text: part.text,
            }
        }

        return {
            kind: "file",
            partId: `prt_gateway_${prompt.promptKey.replaceAll(":", "_")}_${index}`,
            mimeType: part.mimeType,
            fileName: part.fileName,
            localPath: part.localPath,
        }
    })
}

function createAwaitPromptResponseResult(
    sessionId: string,
    messageId: string,
    text: string,
): BindingOpencodeCommandResult {
    return {
        kind: "awaitPromptResponse",
        sessionId,
        messageId,
        parts: [
            {
                messageId,
                partId: "part-1",
                type: "text",
                text,
                ignored: false,
            },
        ],
    }
}

function renderVisibleText(
    parts: Array<{ messageId: string; type: string; text: string | null; ignored: boolean }>,
    messageId: string,
) {
    return parts
        .filter((part) => part.messageId === messageId && part.type === "text" && !part.ignored && part.text !== null)
        .map((part) => part.text)
        .join("\n")
}

function createTextPartUpdatedEvent(sessionID: string, messageID: string, partId: string, text: string) {
    return {
        type: "message.part.updated" as const,
        properties: {
            part: {
                id: partId,
                sessionID,
                messageID,
                type: "text",
                text,
            },
        },
    }
}

function createAssistantMessageUpdatedEvent(sessionID: string, id: string, parentID: string) {
    return {
        type: "message.updated" as const,
        properties: {
            info: {
                sessionID,
                id,
                role: "assistant" as const,
                parentID,
            },
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}

function mockDateNow(value: number) {
    const original = Date.now
    Date.now = () => value
    return () => {
        Date.now = original
    }
}
