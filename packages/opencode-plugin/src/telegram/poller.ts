import type { BindingLoggerHost } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { GatewayMailboxRouter } from "../mailbox/router"
import type { GatewayMailboxRuntime } from "../runtime/mailbox"
import type { SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import { TelegramApiError, type TelegramPollingClientLike } from "./client"
import { buildTelegramAllowlist, normalizeTelegramUpdate } from "./normalize"
import { recordTelegramChatType, recordTelegramPollFailure, recordTelegramPollSuccess } from "./state"

export class TelegramPollingService {
    private readonly allowlist
    private running = false

    constructor(
        private readonly client: TelegramPollingClientLike,
        private readonly mailbox: GatewayMailboxRuntimeLike,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        private readonly config: Extract<TelegramConfig, { enabled: true }>,
        private readonly mailboxRouter: GatewayMailboxRouter,
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
                recordTelegramPollSuccess(this.store, Date.now())

                for (const update of updates) {
                    const nextOffset = update.update_id + 1
                    const normalized = normalizeTelegramUpdate(update, this.allowlist, this.mailboxRouter)

                    if (normalized.kind === "ignore") {
                        this.logger.log("info", `ignoring telegram update ${update.update_id}: ${normalized.reason}`)
                        offset = this.advanceOffset(nextOffset)
                        continue
                    }

                    recordTelegramChatType(
                        this.store,
                        normalized.message.deliveryTarget.target,
                        normalized.chatType,
                        Date.now(),
                    )
                    this.mailbox.enqueueInboundMessage(normalized.message, "telegram_update", String(update.update_id))
                    offset = this.advanceOffset(nextOffset)
                }

                retryDelayMs = 1_000
            } catch (error) {
                recordTelegramPollFailure(this.store, formatTelegramPollerError(error), Date.now())

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

type GatewayMailboxRuntimeLike = Pick<GatewayMailboxRuntime, "enqueueInboundMessage">

function isPermanentTelegramFailure(error: unknown): boolean {
    return error instanceof TelegramApiError && !error.retryable
}

function formatTelegramPollerError(error: unknown): string {
    return `telegram poller failure: ${formatError(error)}`
}

function sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })
}
