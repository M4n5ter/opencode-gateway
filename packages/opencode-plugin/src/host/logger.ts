import type { BindingLoggerHost, BindingLogLevel } from "../binding"

export type GatewayLogLevel = BindingLogLevel | "off"

const LOG_LEVEL_PRIORITY: Record<BindingLogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
}

export class ConsoleLoggerHost implements BindingLoggerHost {
    constructor(private readonly threshold: GatewayLogLevel) {}

    log(level: BindingLogLevel, message: string): void {
        if (!shouldLog(level, this.threshold)) {
            return
        }

        const line = `[gateway:${level}] ${message}`
        switch (level) {
            case "error":
                console.error(line)
                return
            case "warn":
                console.warn(line)
                return
            default:
                console.info(line)
        }
    }
}

export function parseGatewayLogLevel(value: unknown, field: string): GatewayLogLevel {
    if (value === undefined) {
        return "off"
    }

    if (typeof value !== "string") {
        throw new Error(`${field} must be a string when present`)
    }

    const normalized = value.trim().toLowerCase()
    if (normalized === "off") {
        return "off"
    }

    if (isBindingLogLevel(normalized)) {
        return normalized
    }

    throw new Error(`${field} must be one of: off, error, warn, info, debug`)
}

function shouldLog(level: BindingLogLevel, threshold: GatewayLogLevel): boolean {
    if (threshold === "off") {
        return false
    }

    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold]
}

function isBindingLogLevel(value: string): value is BindingLogLevel {
    return value === "debug" || value === "info" || value === "warn" || value === "error"
}
