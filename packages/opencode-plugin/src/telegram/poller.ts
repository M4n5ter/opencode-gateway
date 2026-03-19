import type { BindingLoggerHost, GatewayBindingHandle } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { SqliteStore } from "../store/sqlite"
import { TelegramApiError, type TelegramBotClient } from "./client"
import { buildTelegramAllowlist, normalizeTelegramUpdate } from "./normalize"

export class TelegramPollingService {
    private readonly allowlist
    private running = false

    constructor(
        private readonly client: TelegramBotClient,
        private readonly binding: GatewayBindingHandle,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: Extract<TelegramConfig, { enabled: true }>,
    ) {
        this.allowlist = buildTelegramAllowlist(config)
    }

    start(): void {
        if (this.running) {
            return
        }

        this.running = true
        void this.runLoop().finally(() => {
            this.running = false
        })
    }

    isRunning(): boolean {
        return this.running
    }

    private async runLoop(): Promise<void> {
        let offset = this.store.getTelegramUpdateOffset()
        let retryDelayMs = 1_000

        for (;;) {
            try {
                const updates = await this.client.getUpdates(offset, this.config.pollTimeoutSeconds)

                for (const update of updates) {
                    const nextOffset = update.update_id + 1
                    const normalized = normalizeTelegramUpdate(update, this.allowlist)

                    if (normalized.kind === "ignore") {
                        this.logger.log("info", `ignoring telegram update ${update.update_id}: ${normalized.reason}`)
                        offset = this.advanceOffset(nextOffset)
                        continue
                    }

                    await this.binding.handleInboundMessage(normalized.message)
                    offset = this.advanceOffset(nextOffset)
                }

                retryDelayMs = 1_000
            } catch (error) {
                if (isPermanentTelegramFailure(error)) {
                    this.logger.log("error", formatTelegramPollerError(error))
                    return
                }

                this.logger.log("warn", formatTelegramPollerError(error))
                await sleep(retryDelayMs)
                retryDelayMs = Math.min(retryDelayMs * 2, 15_000)
            }
        }
    }

    private advanceOffset(offset: number): number {
        const recordedAtMs = Date.now()

        this.store.putTelegramUpdateOffset(offset, recordedAtMs)
        return offset
    }
}

function isPermanentTelegramFailure(error: unknown): boolean {
    return error instanceof TelegramApiError && !error.retryable
}

function formatTelegramPollerError(error: unknown): string {
    return `telegram poller failure: ${error instanceof Error ? error.message : String(error)}`
}

function sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}
