import { expect, test } from "bun:test"

import type { BindingLoggerHost, GatewayContract } from "../binding"
import type {
    AppendContextToConversationInput,
    DispatchScheduledJobInput,
    GatewayExecutorLike,
} from "../runtime/executor"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewayCronRuntime } from "./runtime"

test("cron reconcile skips missed runs and marks stale running rows abandoned", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            kind: "cron",
            schedule: "0 9 * * *",
            runAtMs: null,
            prompt: "Summarize work",
            deliveryChannel: null,
            deliveryTarget: null,
            deliveryTopic: null,
            enabled: true,
            nextRunAtMs: 1_735_689_600_000,
            recordedAtMs: 100,
        })
        const staleRunId = store.insertCronRun("nightly", 1_735_689_600_000, 200)

        const runtime = createRuntime(store)

        await runtime.reconcileOnce(1_735_700_000_000)

        expect(store.getCronJob("nightly")?.nextRunAtMs).toBe(1_735_722_000_000)
        const staleRun = db
            .query<{ status: string }, [number]>("SELECT status FROM cron_runs WHERE id = ?1;")
            .get(staleRunId)

        expect(staleRun?.status).toBe("abandoned")
    } finally {
        db.close()
    }
})

test("schedule tick executes due cron jobs and appends the run result back into the target conversation", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const appendedContexts: AppendContextToConversationInput[] = []

        store.upsertCronJob({
            id: "nightly",
            kind: "cron",
            schedule: "0 9 * * *",
            runAtMs: null,
            prompt: "Summarize work",
            deliveryChannel: "telegram",
            deliveryTarget: "-100123",
            deliveryTopic: "42",
            enabled: true,
            nextRunAtMs: 1_735_689_600_000,
            recordedAtMs: 100,
        })

        const runtime = createRuntime(store, { appendedContexts })

        await runtime.tickOnce(1_735_689_600_000)
        await Bun.sleep(0)

        const runRow = db
            .query<{ status: string; response_text: string | null }, []>(
                "SELECT status, response_text FROM cron_runs ORDER BY id DESC LIMIT 1;",
            )
            .get()

        expect(runRow).toEqual({
            status: "succeeded",
            response_text: "assistant reply",
        })
        expect(store.getCronJob("nightly")?.nextRunAtMs).toBe(1_735_722_000_000)
        expect(appendedContexts).toHaveLength(1)
        expect(appendedContexts[0]).toMatchObject({
            conversationKey: "telegram:-100123:topic:42",
            replyTarget: {
                channel: "telegram",
                target: "-100123",
                topic: "42",
            },
        })
        expect(appendedContexts[0]?.body).toContain("job_id=nightly")
        expect(appendedContexts[0]?.body).toContain("status=succeeded")
    } finally {
        db.close()
    }
})

test("schedule_once runs once, disables the job, and exposes succeeded status", async () => {
    const db = createMemoryDatabase()
    const restoreNow = mockDateNow(1_735_689_500_000)

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const runtime = createRuntime(store)
        const job = runtime.scheduleOnce({
            id: "reminder",
            prompt: "Ping me in two minutes",
            delaySeconds: 120,
            runAtMs: null,
            deliveryChannel: "telegram",
            deliveryTarget: "42",
            deliveryTopic: null,
        })

        expect(job.kind).toBe("once")
        expect(job.enabled).toBe(true)

        await runtime.tickOnce(job.nextRunAtMs)
        await Bun.sleep(0)

        const stored = store.getCronJob("reminder")
        expect(stored?.enabled).toBe(false)

        const status = runtime.getJobStatus("reminder")
        expect(status.state).toBe("succeeded")
        expect(status.runs).toHaveLength(1)
        expect(status.runs[0]).toMatchObject({
            status: "succeeded",
            responseText: "assistant reply",
        })
    } finally {
        restoreNow()
        db.close()
    }
})

test("cron reconcile rebases enabled jobs when the effective time zone changes", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            kind: "cron",
            schedule: "0 9 * * *",
            runAtMs: null,
            prompt: "Summarize work",
            deliveryChannel: null,
            deliveryTarget: null,
            deliveryTopic: null,
            enabled: true,
            nextRunAtMs: 1_735_722_000_000,
            recordedAtMs: 100,
        })

        const runtime = createRuntime(store, {
            config: {
                enabled: true,
                tickSeconds: 5,
                maxConcurrentRuns: 1,
                timezone: "Asia/Shanghai",
            },
            timeZone: "Asia/Shanghai",
        })

        await runtime.reconcileOnce(1_735_700_000_000)

        expect(store.getCronJob("nightly")?.nextRunAtMs).toBe(1_735_786_800_000)
        expect(store.getStateValue("cron.effective_timezone")).toBe("Asia/Shanghai")
    } finally {
        db.close()
    }
})

function createRuntime(
    store: SqliteStore,
    options: {
        appendedContexts?: AppendContextToConversationInput[]
        config?: {
            enabled: boolean
            tickSeconds: number
            maxConcurrentRuns: number
            timezone: string | null
        }
        timeZone?: string
    } = {},
): GatewayCronRuntime {
    const binding = createBindingStub()

    return new GatewayCronRuntime(
        createExecutorStub(options.appendedContexts ?? []),
        binding,
        store,
        new MemoryLogger(),
        options.config ?? {
            enabled: true,
            tickSeconds: 5,
            maxConcurrentRuns: 1,
            timezone: null,
        },
        options.timeZone ?? "UTC",
        (target) => binding.conversationKeyForDeliveryTarget(target),
    )
}

function createBindingStub(): GatewayContract {
    return {
        gatewayStatus() {
            return {
                runtimeMode: "contract",
                supportsTelegram: true,
                supportsCron: true,
                hasWebUi: false,
            }
        },
        conversationKeyForDeliveryTarget(target) {
            return target.topic === null
                ? `${target.channel}:${target.target}`
                : `${target.channel}:${target.target}:topic:${target.topic}`
        },
        nextCronRunAt(_job, afterMs, timeZone) {
            if (timeZone === "Asia/Shanghai") {
                return 1_735_786_800_000
            }

            return afterMs < 1_735_722_000_000 ? 1_735_722_000_000 : 1_735_808_400_000
        },
        normalizeCronTimeZone(timeZone: string) {
            return timeZone.trim()
        },
    }
}

function createExecutorStub(appendedContexts: AppendContextToConversationInput[]): GatewayExecutorLike {
    return {
        async handleInboundMessage() {
            throw new Error("unused")
        },
        prepareInboundMessage() {
            throw new Error("unused")
        },
        async executeMailboxEntries() {
            throw new Error("unused")
        },
        async dispatchCronJob() {
            throw new Error("unused")
        },
        async dispatchScheduledJob(input: DispatchScheduledJobInput) {
            return {
                conversationKey: input.conversationKey,
                responseText: "assistant reply",
                delivered: input.replyTarget !== null,
                recordedAtMs: 4_242n,
            }
        },
        async appendContextToConversation(input: AppendContextToConversationInput) {
            appendedContexts.push(input)
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
