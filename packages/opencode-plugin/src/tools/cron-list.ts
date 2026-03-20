import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import { formatUnixMsAsUtc } from "./time"

export function createCronListTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "List persisted gateway cron jobs. Cron schedules are interpreted in UTC.",
        args: {},
        async execute() {
            const jobs = runtime.listJobs()
            if (jobs.length === 0) {
                return "no cron jobs"
            }

            return jobs.map(formatCronJob).join("\n\n")
        },
    })
}

function formatCronJob(job: ReturnType<GatewayCronRuntime["listJobs"]>[number]): string {
    return [
        `id=${job.id}`,
        `enabled=${job.enabled}`,
        `schedule=${job.schedule}`,
        `next_run_at_ms=${job.nextRunAtMs}`,
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
