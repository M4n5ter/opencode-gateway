type RawCronConfig = {
    enabled?: unknown
    tick_seconds?: unknown
    max_concurrent_runs?: unknown
    timezone?: unknown
}

export type CronConfig = {
    enabled: boolean
    tickSeconds: number
    maxConcurrentRuns: number
    timezone: string | null
}

export function parseCronConfig(value: unknown): CronConfig {
    const table = readCronTable(value)

    return {
        enabled: readBoolean(table.enabled, "cron.enabled", true),
        tickSeconds: readPositiveInteger(table.tick_seconds, "cron.tick_seconds", 5),
        maxConcurrentRuns: readPositiveInteger(table.max_concurrent_runs, "cron.max_concurrent_runs", 1),
        timezone: readOptionalString(table.timezone, "cron.timezone"),
    }
}

function readCronTable(value: unknown): RawCronConfig {
    if (value === undefined) {
        return {}
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("cron must be a table when present")
    }

    return value as RawCronConfig
}

function readBoolean(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "boolean") {
        throw new Error(`${field} must be a boolean when present`)
    }

    return value
}

function readPositiveInteger(value: unknown, field: string, fallback: number): number {
    if (value === undefined) {
        return fallback
    }

    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`${field} must be an integer when present`)
    }

    if (value < 1) {
        throw new Error(`${field} must be greater than or equal to 1`)
    }

    return value
}

function readOptionalString(value: unknown, field: string): string | null {
    if (value === undefined) {
        return null
    }

    if (typeof value !== "string") {
        throw new Error(`${field} must be a string when present`)
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
        throw new Error(`${field} must not be empty when present`)
    }

    return trimmed
}
