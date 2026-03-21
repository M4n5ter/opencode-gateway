import type { BindingLoggerHost } from "../binding"

export class ConsoleLoggerHost implements BindingLoggerHost {
    log(level: string, message: string): void {
        const line = `[gateway:${level}] ${message}`

        if (level === "error") {
            console.error(line)
            return
        }

        if (level === "warn") {
            console.warn(line)
            return
        }

        console.info(line)
    }
}
