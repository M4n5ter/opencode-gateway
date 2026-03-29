import type { BindingDeliveryTarget, BindingDispatchReport, BindingLoggerHost, GatewayContract } from "../binding"
import type { CronConfig } from "../config/cron"
import type { GatewayExecutorLike } from "../runtime/executor"
import type { CronJobRecord, CronRunRecord, PersistCronJobInput, SqliteStore } from "../store/sqlite"
import { formatUnixMsAsUtc, formatUnixMsInTimeZone } from "../tools/time"
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

export type ScheduleOnceInput = {
    id: string
    prompt: string
    delaySeconds: number | null
    runAtMs: number | null
    deliveryChannel: string | null
    deliveryTarget: string | null
    deliveryTopic: string | null
}

export type ScheduleJobState = "scheduled" | "running" | "succeeded" | "failed" | "abandoned" | "canceled"

export type ScheduleJobStatus = {
    job: CronJobRecord
    state: ScheduleJobState
    runs: CronRunRecord[]
}

const CRON_EFFECTIVE_TIME_ZONE_KEY = "cron.effective_timezone"
const LEGACY_CRON_TIME_ZONE = "UTC"
const MAX_STATUS_RUNS = 20

export class GatewayCronRuntime {
    private readonly runningJobIds = new Set<string>()
    private running = false

    constructor(
        private readonly executor: GatewayExecutorLike,
        private readonly contract: GatewayContract,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: CronConfig,
        private readonly effectiveTimeZone: string,
        private readonly resolveConversationKeyForTarget: (target: BindingDeliveryTarget) => string,
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

    timeZone(): string {
        return this.effectiveTimeZone
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

    listJobs(includeTerminal = false): CronJobRecord[] {
        const jobs = this.store.listCronJobs()
        if (includeTerminal) {
            return jobs
        }

        return jobs.filter((job) => !isTerminalJob(job))
    }

    getJobStatus(id: string, limit = 5): ScheduleJobStatus {
        const job = this.requireJob(normalizeId(id))
        const runs = this.store.listCronRuns(job.id, clampStatusLimit(limit))

        return {
            job,
            state: deriveJobState(job, runs[0] ?? null),
            runs,
        }
    }

    upsertJob(input: UpsertCronJobInput): CronJobRecord {
        const normalized = normalizeUpsertInput(input)
        const recordedAtMs = Date.now()
        const nextRunAtMs = computeNextRunAt(this.contract, normalized, recordedAtMs, this.effectiveTimeZone)

        this.store.upsertCronJob({
            ...normalized,
            nextRunAtMs,
            recordedAtMs,
        })

        return this.requireJob(normalized.id)
    }

    scheduleOnce(input: ScheduleOnceInput): CronJobRecord {
        const normalized = normalizeOnceInput(input)
        const recordedAtMs = Date.now()

        this.store.upsertCronJob({
            ...normalized,
            nextRunAtMs: normalized.runAtMs ?? recordedAtMs,
            recordedAtMs,
        })

        return this.requireJob(normalized.id)
    }

    cancelJob(id: string): boolean {
        const job = this.store.getCronJob(normalizeId(id))
        if (job === null || !job.enabled) {
            return false
        }

        this.store.setCronJobEnabled(job.id, false, Date.now())
        return true
    }

    async runNow(id: string): Promise<BindingDispatchReport> {
        const job = this.requireJob(normalizeId(id))
        if (!job.enabled) {
            throw new Error(`schedule job is not active: ${job.id}`)
        }

        if (this.runningJobIds.has(job.id)) {
            throw new Error(`schedule job is already running: ${job.id}`)
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

        const storedTimeZone = this.readStoredEffectiveTimeZone()
        const previousTimeZone = storedTimeZone ?? LEGACY_CRON_TIME_ZONE
        if (previousTimeZone !== this.effectiveTimeZone) {
            const message =
                storedTimeZone === null
                    ? `rebasing enabled cron jobs from legacy ${LEGACY_CRON_TIME_ZONE} semantics to ${this.effectiveTimeZone}`
                    : `cron time zone changed from ${previousTimeZone} to ${this.effectiveTimeZone}; rebasing enabled jobs`
            this.logger.log("warn", message)
            this.rebaseJobs(
                this.store.listCronJobs().filter((job) => job.enabled && job.kind === "cron"),
                nowMs,
            )
        } else {
            this.rebaseJobs(this.store.listOverdueCronJobs(nowMs), nowMs)
        }

        this.store.putStateValue(CRON_EFFECTIVE_TIME_ZONE_KEY, this.effectiveTimeZone, nowMs)
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
                    this.logger.log("error", `schedule job ${job.id} failed: ${formatError(error)}`)
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
    ): Promise<BindingDispatchReport> {
        const startedAtMs = Date.now()
        if (job.kind === "cron" && nextRunBaseMs !== null) {
            const nextRunAtMs = computeNextRunAt(
                this.contract,
                job,
                Math.max(nextRunBaseMs, scheduledForMs),
                this.effectiveTimeZone,
            )
            this.store.updateCronJobNextRun(job.id, nextRunAtMs, startedAtMs)
        } else if (job.kind === "once") {
            this.store.setCronJobEnabled(job.id, false, startedAtMs)
        }

        const runId = this.store.insertCronRun(job.id, scheduledForMs, startedAtMs)

        try {
            const report = await this.executor.dispatchScheduledJob({
                jobId: job.id,
                jobKind: job.kind,
                conversationKey: conversationKeyForJob(job),
                prompt: formatScheduledExecutionPrompt(job, scheduledForMs, startedAtMs, this.effectiveTimeZone),
                replyTarget: toReplyTarget(job),
            })
            this.store.finishCronRun(runId, "succeeded", Date.now(), report.execution.responseText, null)
            if (report.delivery !== null && report.delivery.failedTargets.length > 0) {
                this.logger.log(
                    "warn",
                    `schedule job ${job.id} delivery finished with ${report.delivery.failedTargets.length} failed target(s)`,
                )
            }
            await this.appendScheduleResultToTarget(job, scheduledForMs, {
                kind: "success",
                responseText: report.execution.responseText,
            })
            return report
        } catch (error) {
            const message = formatError(error)
            this.store.finishCronRun(runId, "failed", Date.now(), null, message)
            await this.appendScheduleResultToTarget(job, scheduledForMs, {
                kind: "failure",
                errorMessage: message,
            })
            throw error
        }
    }

    private async appendScheduleResultToTarget(
        job: CronJobRecord,
        scheduledForMs: number,
        outcome:
            | {
                  kind: "success"
                  responseText: string
              }
            | {
                  kind: "failure"
                  errorMessage: string
              },
    ): Promise<void> {
        const replyTarget = toReplyTarget(job)
        if (replyTarget === null) {
            return
        }

        try {
            await this.executor.appendContextToConversation({
                conversationKey: this.resolveConversationKeyForTarget(replyTarget),
                replyTarget,
                body: formatScheduleContextNote(job, scheduledForMs, outcome),
                recordedAtMs: Date.now(),
            })
        } catch (error) {
            this.logger.log(
                "warn",
                `failed to append schedule result to ${replyTarget.channel}:${replyTarget.target}: ${formatError(error)}`,
            )
        }
    }

    private requireJob(id: string): CronJobRecord {
        const job = this.store.getCronJob(id)
        if (job === null) {
            throw new Error(`unknown schedule job: ${id}`)
        }

        return job
    }

    private rebaseJobs(jobs: CronJobRecord[], nowMs: number): void {
        for (const job of jobs) {
            try {
                const nextRunAtMs = computeNextRunAt(this.contract, job, nowMs, this.effectiveTimeZone)
                this.store.updateCronJobNextRun(job.id, nextRunAtMs, nowMs)
            } catch (error) {
                this.logger.log("error", `failed to rebase cron job ${job.id}: ${formatError(error)}`)
            }
        }
    }

    private readStoredEffectiveTimeZone(): string | null {
        const stored = this.store.getStateValue(CRON_EFFECTIVE_TIME_ZONE_KEY)
        if (stored === null) {
            return null
        }

        try {
            return this.contract.normalizeCronTimeZone(stored)
        } catch (error) {
            this.logger.log(
                "warn",
                `stored cron time zone is invalid (${stored}); treating as legacy ${LEGACY_CRON_TIME_ZONE}: ${formatError(error)}`,
            )
            return null
        }
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
        kind: "cron",
        schedule,
        runAtMs: null,
        prompt,
        enabled: input.enabled,
        deliveryChannel,
        deliveryTarget,
        deliveryTopic,
        nextRunAtMs: 0,
        recordedAtMs: 0,
    }
}

function normalizeOnceInput(input: ScheduleOnceInput): PersistCronJobInput {
    const id = normalizeId(input.id)
    const prompt = normalizeRequiredField(input.prompt, "schedule prompt")
    const deliveryChannel = normalizeOptionalField(input.deliveryChannel)
    const deliveryTarget = normalizeOptionalField(input.deliveryTarget)
    const deliveryTopic = normalizeOptionalField(input.deliveryTopic)

    if ((deliveryChannel === null) !== (deliveryTarget === null)) {
        throw new Error("schedule delivery_channel and delivery_target must be provided together")
    }

    if (deliveryChannel === null && deliveryTopic !== null) {
        throw new Error("schedule delivery_topic requires delivery_channel and delivery_target")
    }

    if (deliveryChannel !== null && deliveryChannel !== "telegram") {
        throw new Error(`unsupported schedule delivery channel: ${deliveryChannel}`)
    }

    const runAtMs = resolveOnceRunAt(input)

    return {
        id,
        kind: "once",
        schedule: null,
        runAtMs,
        prompt,
        enabled: true,
        deliveryChannel,
        deliveryTarget,
        deliveryTopic,
        nextRunAtMs: runAtMs,
        recordedAtMs: 0,
    }
}

function resolveOnceRunAt(input: ScheduleOnceInput): number {
    if (input.delaySeconds === null && input.runAtMs === null) {
        throw new Error("schedule_once requires delay_seconds or run_at_ms")
    }

    if (input.delaySeconds !== null && input.runAtMs !== null) {
        throw new Error("schedule_once accepts only one of delay_seconds or run_at_ms")
    }

    if (input.runAtMs !== null) {
        if (!Number.isSafeInteger(input.runAtMs) || input.runAtMs < 0) {
            throw new Error("schedule run_at_ms must be a non-negative integer")
        }

        return input.runAtMs
    }

    const delaySeconds = input.delaySeconds ?? 0
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 0) {
        throw new Error("schedule delay_seconds must be a non-negative integer")
    }

    return Date.now() + delaySeconds * 1_000
}

function normalizeId(id: string): string {
    return normalizeRequiredField(id, "schedule id")
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
) {
    return {
        id: job.id,
        schedule: normalizeRequiredField(job.schedule ?? "", "cron schedule"),
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
    timeZone: string,
): number {
    const nextRunAt = contract.nextCronRunAt(toBindingCronJobSpec(job), afterMs, timeZone)
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

function clampStatusLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error("schedule_status limit must be a positive integer")
    }

    return Math.min(limit, MAX_STATUS_RUNS)
}

function deriveJobState(job: CronJobRecord, latestRun: CronRunRecord | null): ScheduleJobState {
    if (latestRun?.status === "running") {
        return "running"
    }

    if (job.enabled) {
        return "scheduled"
    }

    if (latestRun !== null) {
        return latestRun.status
    }

    return "canceled"
}

function isTerminalJob(job: CronJobRecord): boolean {
    return !job.enabled
}

function toReplyTarget(
    job: Pick<CronJobRecord, "deliveryChannel" | "deliveryTarget" | "deliveryTopic">,
): BindingDeliveryTarget | null {
    if (job.deliveryChannel === null || job.deliveryTarget === null) {
        return null
    }

    return {
        channel: job.deliveryChannel,
        target: job.deliveryTarget,
        topic: job.deliveryTopic,
    }
}

function conversationKeyForJob(job: Pick<CronJobRecord, "id" | "kind">): string {
    return job.kind === "cron" ? `cron:${job.id}` : `once:${job.id}`
}

function formatScheduledExecutionPrompt(
    job: Pick<CronJobRecord, "id" | "kind" | "prompt" | "schedule">,
    scheduledForMs: number,
    dispatchedAtMs: number,
    timeZone: string,
): string {
    const header = [
        "[Gateway schedule context]",
        `job_id=${job.id}`,
        `job_kind=${job.kind}`,
        `timezone=${timeZone}`,
        ...(job.schedule === null ? [] : [`schedule=${job.schedule}`]),
        `scheduled_for_ms=${scheduledForMs}`,
        `scheduled_for_local=${formatUnixMsInTimeZone(scheduledForMs, timeZone)}`,
        `scheduled_for_utc=${formatUnixMsAsUtc(scheduledForMs)}`,
        `dispatched_at_ms=${dispatchedAtMs}`,
        `dispatched_at_local=${formatUnixMsInTimeZone(dispatchedAtMs, timeZone)}`,
        `dispatched_at_utc=${formatUnixMsAsUtc(dispatchedAtMs)}`,
        "",
        "This task was triggered automatically by the gateway scheduler, not by a live user message.",
        "Use the schedule context above when interpreting time-relative instructions.",
        "",
        "[Requested task]",
    ]

    return [...header, job.prompt].join("\n")
}

function formatScheduleContextNote(
    job: Pick<CronJobRecord, "id" | "kind">,
    scheduledForMs: number,
    outcome:
        | {
              kind: "success"
              responseText: string
          }
        | {
              kind: "failure"
              errorMessage: string
          },
): string {
    const header = [
        "[Gateway schedule result]",
        `job_id=${job.id}`,
        `job_kind=${job.kind}`,
        `scheduled_for_ms=${scheduledForMs}`,
    ]

    if (outcome.kind === "success") {
        return [...header, "status=succeeded", "", outcome.responseText].join("\n")
    }

    return [...header, "status=failed", "", outcome.errorMessage].join("\n")
}
