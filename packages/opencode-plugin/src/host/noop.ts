import type { BindingClockHost, BindingLoggerHost, BindingOutboundMessage, BindingTransportHost } from "../binding"

export class NoopTransportHost implements BindingTransportHost {
    async sendMessage(_message: BindingOutboundMessage): Promise<void> {}
}

export class SystemClockHost implements BindingClockHost {
    nowUnixMs(): bigint {
        return BigInt(Date.now())
    }
}

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
