import type { BindingLoggerHost } from "../binding"
import { delay } from "../runtime/delay"
import type { SqliteStore, TelegramMessageCleanupRecord } from "../store/sqlite"
import { formatError } from "../utils/error"
import { TelegramApiError, type TelegramMessageDeleteClientLike } from "./client"

const CLEANUP_POLL_INTERVAL_MS = 1_000
const CLEANUP_LEASE_MS = 30_000
const CLEANUP_RETRY_DELAY_MS = 5_000
const CLEANUP_MAX_ATTEMPTS = 5

type TelegramCleanupTiming = {
    pollIntervalMs: number
    leaseMs: number
    retryDelayMs: number
    maxAttempts: number
}

export class TelegramMessageCleanupRuntime {
    private running = false
    private readonly timing: TelegramCleanupTiming

    constructor(
        private readonly client: TelegramMessageDeleteClientLike | null,
        private readonly store: SqliteStore,
        private readonly logger: BindingLoggerHost,
        timing?: Partial<TelegramCleanupTiming>,
    ) {
        this.timing = {
            pollIntervalMs: timing?.pollIntervalMs ?? CLEANUP_POLL_INTERVAL_MS,
            leaseMs: timing?.leaseMs ?? CLEANUP_LEASE_MS,
            retryDelayMs: timing?.retryDelayMs ?? CLEANUP_RETRY_DELAY_MS,
            maxAttempts: timing?.maxAttempts ?? CLEANUP_MAX_ATTEMPTS,
        }
    }

    start(): void {
        if (this.running || this.client === null) {
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
            const job = this.store.claimNextTelegramMessageCleanup(Date.now(), Date.now() + this.timing.leaseMs)
            if (job === null) {
                await delay(this.timing.pollIntervalMs)
                continue
            }

            await this.processJob(job)
        }
    }

    private async processJob(job: TelegramMessageCleanupRecord): Promise<void> {
        if (this.client === null) {
            return
        }

        try {
            await this.client.deleteMessage(job.chatId, job.messageId)
            this.store.completeTelegramMessageCleanup(job.id)
        } catch (error) {
            const message = formatError(error)
            if (isMissingDeleteTarget(message)) {
                this.store.completeTelegramMessageCleanup(job.id)
                return
            }

            if (error instanceof TelegramApiError && !error.retryable) {
                this.store.completeTelegramMessageCleanup(job.id)
                this.logger.log("warn", `dropping telegram cleanup ${job.id}: ${message}`)
                return
            }

            const dropped = this.store.recordTelegramMessageCleanupFailure(
                job.id,
                message,
                Date.now(),
                Date.now() + this.timing.retryDelayMs,
                this.timing.maxAttempts,
            )
            this.logger.log(
                dropped ? "warn" : "debug",
                `${dropped ? "dropping" : "retrying"} telegram cleanup ${job.id}: ${message}`,
            )
        }
    }
}

function isMissingDeleteTarget(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes("message to delete not found") || normalized.includes("message can't be deleted")
}
