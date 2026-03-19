import type {
    BindingClockHost,
    BindingCronJobSpec,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingOutboundMessage,
    BindingStoreHost,
    BindingTransportHost,
} from "../binding"

export class NoopStoreHost implements BindingStoreHost {
    async recordInboundMessage(_message: BindingInboundMessage, _recordedAtMs: bigint): Promise<void> {}

    async recordCronDispatch(_job: BindingCronJobSpec, _recordedAtMs: bigint): Promise<void> {}

    async recordDelivery(_message: BindingOutboundMessage, _recordedAtMs: bigint): Promise<void> {}
}

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
