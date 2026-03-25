import type { OpencodeClient } from "@opencode-ai/sdk"

import type { BindingLoggerHost } from "../binding"
import { delay } from "../runtime/delay"
import { formatError } from "../utils/error"
import type { OpencodeEventHub, OpencodeRuntimeEvent } from "./events"

const RECONNECT_DELAY_MS = 1_000

export class OpencodeEventStream {
    private running = false
    private connected = false
    private lastError: string | null = null

    constructor(
        private readonly client: OpencodeClient,
        private readonly directory: string,
        private readonly hub: OpencodeEventHub,
        private readonly consumers: OpencodeEventConsumerLike[],
        private readonly logger: BindingLoggerHost,
    ) {}

    isConnected(): boolean {
        return this.connected
    }

    lastStreamError(): string | null {
        return this.lastError
    }

    start(): void {
        if (this.running) {
            return
        }

        this.running = true
        void this.runLoop()
    }

    stop(): void {
        this.running = false
    }

    private async runLoop(): Promise<void> {
        while (this.running) {
            try {
                const events = await this.client.event.subscribe({
                    query: { directory: this.directory },
                    onSseError: (error) => {
                        this.connected = false
                        this.lastError = formatError(error)
                    },
                })

                this.connected = true
                this.lastError = null

                for await (const event of events.stream) {
                    const runtimeEvent = event as OpencodeRuntimeEvent
                    this.hub.handleEvent(runtimeEvent)
                    for (const consumer of this.consumers) {
                        consumer.handleEvent(runtimeEvent)
                    }
                }
            } catch (error) {
                this.lastError = formatError(error)
                this.logger.log("warn", `opencode event stream failed: ${this.lastError}`)
            } finally {
                this.connected = false
            }

            await delay(RECONNECT_DELAY_MS)
        }
    }
}

type OpencodeEventConsumerLike = {
    handleEvent(event: OpencodeRuntimeEvent): void
}
