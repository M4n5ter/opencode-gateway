import type { BindingCronJobSpec, BindingLoggerHost, BindingRuntimeReport, GatewayContract } from "../binding"
import type { CronConfig } from "../config/cron"
import type { GatewayExecutorLike } from "../runtime/executor"
import type { CronJobRecord, PersistCronJobInput, SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"

export type UpsertCronJobInput = {
    id: string
    schedule: string
    prompt: string
    enabled: boolean
    deliveryChannel: string | null
    deliveryTarget: string | null
    deliveryTopic: string | null
}

export class GatewayCronRuntime {
    private readonly runningJobIds = new Set<string>()
    private running = false

    constructor(
        private readonly executor: GatewayExecutorLike,
        private readonly contract: GatewayContract,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: CronConfig,
    ) {}

    isEnabled(): boolean {
        return this.config.enabled
    }

    isRunning(): boolean {
        return this.running
    }

    runningJobs(): number {
        return this.runningJobIds.size
    }

    start(): void {
        if (!this.config.enabled || this.running) {
            return
        }

        this.running = true
        void this.runLoop().finally(() => {
            this.running = false
        })
    }

    listJobs(): CronJobRecord[] {
        return this.store.listCronJobs()
    }

    upsertJob(input: UpsertCronJobInput): CronJobRecord {
        const normalized = normalizeUpsertInput(input)
        const recordedAtMs = Date.now()
        const nextRunAtMs = computeNextRunAt(this.contract, normalized, recordedAtMs)

        this.store.upsertCronJob({
            ...normalized,
            nextRunAtMs,
            recordedAtMs,
        })

        return this.requireJob(normalized.id)
    }

    removeJob(id: string): boolean {
        return this.store.removeCronJob(normalizeId(id))
    }

    async runNow(id: string): Promise<BindingRuntimeReport> {
        const job = this.requireJob(normalizeId(id))
        if (this.runningJobIds.has(job.id)) {
            throw new Error(`cron job is already running: ${job.id}`)
        }

        this.runningJobIds.add(job.id)

        try {
            return await this.executeJob(job, Date.now(), null)
        } finally {
            this.runningJobIds.delete(job.id)
        }
    }

    private async runLoop(): Promise<void> {
        await this.reconcileOnce()

        for (;;) {
            await this.tickOnce()
            await sleep(this.config.tickSeconds * 1_000)
        }
    }

    async reconcileOnce(nowMs = Date.now()): Promise<void> {
        const abandoned = this.store.abandonRunningCronRuns(nowMs)

        if (abandoned > 0) {
            this.logger.log("warn", `abandoned ${abandoned} stale cron runs on startup`)
        }

        for (const job of this.store.listOverdueCronJobs(nowMs)) {
            try {
                const nextRunAtMs = computeNextRunAt(this.contract, job, nowMs)
                this.store.updateCronJobNextRun(job.id, nextRunAtMs, nowMs)
            } catch (error) {
                this.logger.log("error", `failed to rebase cron job ${job.id}: ${formatError(error)}`)
            }
        }
    }

    async tickOnce(nowMs = Date.now()): Promise<void> {
        const capacity = this.config.maxConcurrentRuns - this.runningJobIds.size
        if (capacity <= 0) {
            return
        }

        const dueJobs = this.store.listDueCronJobs(nowMs, capacity)
        for (const job of dueJobs) {
            if (this.runningJobIds.has(job.id)) {
                continue
            }

            this.runningJobIds.add(job.id)
            void this.executeJob(job, job.nextRunAtMs, nowMs)
                .catch((error) => {
                    this.logger.log("error", `cron job ${job.id} failed: ${formatError(error)}`)
                })
                .finally(() => {
                    this.runningJobIds.delete(job.id)
                })

            if (this.runningJobIds.size >= this.config.maxConcurrentRuns) {
                return
            }
        }
    }

    private async executeJob(
        job: CronJobRecord,
        scheduledForMs: number,
        nextRunBaseMs: number | null,
    ): Promise<BindingRuntimeReport> {
        const startedAtMs = Date.now()
        if (nextRunBaseMs !== null) {
            const nextRunAtMs = computeNextRunAt(this.contract, job, Math.max(nextRunBaseMs, scheduledForMs))
            this.store.updateCronJobNextRun(job.id, nextRunAtMs, startedAtMs)
        }

        const runId = this.store.insertCronRun(job.id, scheduledForMs, startedAtMs)

        try {
            const report = await this.executor.dispatchCronJob(toBindingCronJobSpec(job))
            this.store.finishCronRun(runId, "succeeded", Date.now(), report.responseText, null)
            return report
        } catch (error) {
            const message = formatError(error)
            this.store.finishCronRun(runId, "failed", Date.now(), null, message)
            throw error
        }
    }

    private requireJob(id: string): CronJobRecord {
        const job = this.store.getCronJob(id)
        if (job === null) {
            throw new Error(`unknown cron job: ${id}`)
        }

        return job
    }
}

function normalizeUpsertInput(input: UpsertCronJobInput): PersistCronJobInput {
    const id = normalizeId(input.id)
    const schedule = normalizeRequiredField(input.schedule, "cron schedule")
    const prompt = normalizeRequiredField(input.prompt, "cron prompt")
    const deliveryChannel = normalizeOptionalField(input.deliveryChannel)
    const deliveryTarget = normalizeOptionalField(input.deliveryTarget)
    const deliveryTopic = normalizeOptionalField(input.deliveryTopic)

    if ((deliveryChannel === null) !== (deliveryTarget === null)) {
        throw new Error("cron delivery_channel and delivery_target must be provided together")
    }

    if (deliveryChannel === null && deliveryTopic !== null) {
        throw new Error("cron delivery_topic requires delivery_channel and delivery_target")
    }

    if (deliveryChannel !== null && deliveryChannel !== "telegram") {
        throw new Error(`unsupported cron delivery channel: ${deliveryChannel}`)
    }

    return {
        id,
        schedule,
        prompt,
        enabled: input.enabled,
        deliveryChannel,
        deliveryTarget,
        deliveryTopic,
        nextRunAtMs: 0,
        recordedAtMs: 0,
    }
}

function normalizeId(id: string): string {
    return normalizeRequiredField(id, "cron id")
}

function normalizeRequiredField(value: string, field: string): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty`)
    }

    return trimmed
}

function normalizeOptionalField(value: string | null): string | null {
    if (value === null) {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}

function toBindingCronJobSpec(
    job: Pick<
        CronJobRecord | PersistCronJobInput,
        "id" | "schedule" | "prompt" | "deliveryChannel" | "deliveryTarget" | "deliveryTopic"
    >,
): BindingCronJobSpec {
    return {
        id: job.id,
        schedule: job.schedule,
        prompt: job.prompt,
        deliveryChannel: job.deliveryChannel,
        deliveryTarget: job.deliveryTarget,
        deliveryTopic: job.deliveryTopic,
    }
}

function computeNextRunAt(
    contract: GatewayContract,
    job: Pick<
        CronJobRecord | PersistCronJobInput,
        "id" | "schedule" | "prompt" | "deliveryChannel" | "deliveryTarget" | "deliveryTopic"
    >,
    afterMs: number,
): number {
    const nextRunAt = contract.nextCronRunAt(toBindingCronJobSpec(job), afterMs)
    if (!Number.isSafeInteger(nextRunAt) || nextRunAt < 0) {
        throw new Error(`next cron run at is out of range for JavaScript: ${nextRunAt}`)
    }

    return nextRunAt
}

function sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}
