import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { GatewayCronRuntime } from "../cron/runtime"
import { formatScheduleJob } from "./schedule-format"

export function createScheduleListTool(runtime: GatewayCronRuntime): ToolDefinition {
    return tool({
        description: "List persisted gateway schedule jobs, including recurring cron jobs and one-shot timers.",
        args: {
            include_terminal: tool.schema.boolean().optional(),
        },
        async execute(args) {
            const jobs = runtime.listJobs(args.include_terminal ?? false)
            if (jobs.length === 0) {
                return "no scheduled jobs"
            }

            return jobs.map((job) => formatScheduleJob(job, runtime.timeZone())).join("\n\n")
        },
    })
}
