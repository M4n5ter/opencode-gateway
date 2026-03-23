import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"

import type { BindingCronJobSpec, BindingLoggerHost, GatewayContract } from "../binding"
import type { GatewayExecutorLike } from "../runtime/executor"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayCronRuntime } from "./runtime"

test("cron reconcile skips missed runs and marks stale running rows abandoned", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: null,
            deliveryTarget: null,
            deliveryTopic: null,
            enabled: true,
            nextRunAtMs: 1_735_689_600_000,
            recordedAtMs: 100,
        })
        const staleRunId = store.insertCronRun("nightly", 1_735_689_600_000, 200)

        const runtime = new GatewayCronRuntime(
            createExecutorStub(),
            createBindingStub(),
            store,
            new MemoryLogger(),
            {
                enabled: true,
                tickSeconds: 5,
                maxConcurrentRuns: 1,
                timezone: null,
            },
            "UTC",
        )

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

test("cron tick executes due jobs and records successful runs", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: "telegram",
            deliveryTarget: "-100123",
            deliveryTopic: "42",
            enabled: true,
            nextRunAtMs: 1_735_689_600_000,
            recordedAtMs: 100,
        })

        const runtime = new GatewayCronRuntime(
            createExecutorStub(),
            createBindingStub(),
            store,
            new MemoryLogger(),
            {
                enabled: true,
                tickSeconds: 5,
                maxConcurrentRuns: 1,
                timezone: null,
            },
            "UTC",
        )

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
    } finally {
        db.close()
    }
})

test("cron reconcile rebases enabled jobs when the effective time zone changes", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.upsertCronJob({
            id: "nightly",
            schedule: "0 9 * * *",
            prompt: "Summarize work",
            deliveryChannel: null,
            deliveryTarget: null,
            deliveryTopic: null,
            enabled: true,
            nextRunAtMs: 1_735_722_000_000,
            recordedAtMs: 100,
        })

        const runtime = new GatewayCronRuntime(
            createExecutorStub(),
            createBindingStub(),
            store,
            new MemoryLogger(),
            {
                enabled: true,
                tickSeconds: 5,
                maxConcurrentRuns: 1,
                timezone: "Asia/Shanghai",
            },
            "Asia/Shanghai",
        )

        await runtime.reconcileOnce(1_735_700_000_000)

        expect(store.getCronJob("nightly")?.nextRunAtMs).toBe(1_735_786_800_000)
        expect(store.getStateValue("cron.effective_timezone")).toBe("Asia/Shanghai")
    } finally {
        db.close()
    }
})

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
        nextCronRunAt(_job: BindingCronJobSpec, afterMs: number, timeZone: string): number {
            if (timeZone === "Asia/Shanghai") {
                return 1_735_786_800_000
            }

            return afterMs < 1_735_722_000_000 ? 1_735_722_000_000 : 1_735_808_400_000
        },
        normalizeCronTimeZone(timeZone: string): string {
            return timeZone.trim()
        },
    }
}

function createExecutorStub(): GatewayExecutorLike {
    return {
        async handleInboundMessage(_message) {
            throw new Error("unused")
        },
        prepareInboundMessage() {
            throw new Error("unused")
        },
        async executeMailboxEntries() {
            throw new Error("unused")
        },
        async dispatchCronJob(_job: BindingCronJobSpec) {
            return {
                conversationKey: "cron:nightly",
                responseText: "assistant reply",
                delivered: true,
                recordedAtMs: 4_242n,
            }
        },
    }
}

class MemoryLogger implements BindingLoggerHost {
    log(_level: string, _message: string): void {}
}
