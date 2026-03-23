import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import { formatUnixMsAsUtc, formatUnixMsInTimeZone } from "./time"

export function createCronListTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "List persisted gateway cron jobs. Schedules use cron.timezone or the runtime local time zone.",
        args: {},
        async execute() {
            const jobs = runtime.listJobs()
            if (jobs.length === 0) {
                return "no cron jobs"
            }

            return jobs.map((job) => formatCronJob(job, runtime.timeZone())).join("\n\n")
        },
    })
}

function formatCronJob(job: ReturnType<GatewayCronRuntime["listJobs"]>[number], timeZone: string): string {
    return [
        `id=${job.id}`,
        `enabled=${job.enabled}`,
        `schedule=${job.schedule}`,
        `timezone=${timeZone}`,
        `next_run_at_ms=${job.nextRunAtMs}`,
        `next_run_at_local=${formatUnixMsInTimeZone(job.nextRunAtMs, timeZone)}`,
        `next_run_at_utc=${formatUnixMsAsUtc(job.nextRunAtMs)}`,
        `delivery=${formatDelivery(job.deliveryChannel, job.deliveryTarget, job.deliveryTopic)}`,
        `prompt=${job.prompt}`,
    ].join("\n")
}

function formatDelivery(channel: string | null, target: string | null, topic: string | null): string {
    if (channel === null || target === null) {
        return "none"
    }

    return topic === null ? `${channel}:${target}` : `${channel}:${target}:topic:${topic}`
}
