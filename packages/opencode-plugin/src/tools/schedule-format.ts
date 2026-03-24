import type { ScheduleJobStatus } from "../cron/runtime"
import type { CronJobRecord, CronRunRecord } from "../store/sqlite"
import { formatUnixMsAsUtc, formatUnixMsInTimeZone } from "./time"

export function formatScheduleJob(job: CronJobRecord, timeZone: string): string {
    const lines = [`id=${job.id}`, `kind=${job.kind}`, `enabled=${job.enabled}`]

    if (job.kind === "cron") {
        lines.push(`schedule=${job.schedule}`)
        lines.push(`timezone=${timeZone}`)
        lines.push(`next_run_at_ms=${job.nextRunAtMs}`)
        lines.push(`next_run_at_local=${formatUnixMsInTimeZone(job.nextRunAtMs, timeZone)}`)
        lines.push(`next_run_at_utc=${formatUnixMsAsUtc(job.nextRunAtMs)}`)
    } else {
        lines.push(`run_at_ms=${job.runAtMs ?? "none"}`)
        if (job.runAtMs !== null) {
            lines.push(`run_at_local=${formatUnixMsInTimeZone(job.runAtMs, timeZone)}`)
            lines.push(`run_at_utc=${formatUnixMsAsUtc(job.runAtMs)}`)
        }
    }

    lines.push(`delivery=${formatDelivery(job.deliveryChannel, job.deliveryTarget, job.deliveryTopic)}`)
    lines.push(`prompt=${job.prompt}`)
    return lines.join("\n")
}

export function formatScheduleStatus(status: ScheduleJobStatus, timeZone: string): string {
    const lines = [formatScheduleJob(status.job, timeZone), `state=${status.state}`]

    if (status.runs.length === 0) {
        lines.push("runs=none")
        return lines.join("\n")
    }

    lines.push("")
    lines.push(...status.runs.map((run, index) => formatRun(run, index + 1)))
    return lines.join("\n")
}

function formatRun(run: CronRunRecord, ordinal: number): string {
    return [
        `run[${ordinal}].id=${run.id}`,
        `run[${ordinal}].status=${run.status}`,
        `run[${ordinal}].scheduled_for_ms=${run.scheduledForMs}`,
        `run[${ordinal}].started_at_ms=${run.startedAtMs}`,
        `run[${ordinal}].finished_at_ms=${run.finishedAtMs ?? "none"}`,
        `run[${ordinal}].response_text=${run.responseText ?? "none"}`,
        `run[${ordinal}].error_message=${run.errorMessage ?? "none"}`,
    ].join("\n")
}

function formatDelivery(channel: string | null, target: string | null, topic: string | null): string {
    if (channel === null || target === null) {
        return "none"
    }

    return topic === null ? `${channel}:${target}` : `${channel}:${target}:topic:${topic}`
}
