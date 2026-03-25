import { expect, test } from "bun:test"

import type { BindingInboundMessage, BindingLoggerHost } from "../binding"
import { GatewayMailboxRouter } from "../mailbox/router"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { TelegramApiError } from "./client"
import type { TelegramNormalizedInboundMessage } from "./normalize"
import { TelegramPollingService } from "./poller"
import type { TelegramUpdate } from "./types"

test("telegram poller aborts stalled getUpdates calls and records a timeout", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const logger = new MemoryLogger()
        let calls = 0
        const client = {
            async getUpdates(
                _offset: number | null,
                _timeoutSeconds: number,
                signal?: AbortSignal,
            ): Promise<TelegramUpdate[]> {
                calls += 1

                if (calls === 1) {
                    return await new Promise<TelegramUpdate[]>((_resolve, reject) => {
                        signal?.addEventListener("abort", () => {
                            reject(new DOMException("aborted", "AbortError"))
                        })
                    })
                }

                throw new TelegramApiError("stop", false)
            },
        }

        const poller = new TelegramPollingService(
            client,
            new NoopMailbox(),
            store,
            logger,
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 1,
                allowedChats: [],
                allowedUsers: ["6212645712"],
            },
            new GatewayMailboxRouter([]),
            new NoopMediaStore(),
            new NoopQuestions(),
            {
                timeoutFloorMs: 10,
                timeoutGraceMs: 10,
                stallGraceMs: 10,
            },
        )

        poller.start()
        await waitFor(() => logger.messages.some((entry) => entry.includes("telegram poller timeout after 1010ms")))
        await waitFor(() => !poller.isRunning())

        expect(store.getStateValue("telegram.last_poll_timeout_at_ms")).not.toBeNull()
        expect(store.getStateValue("telegram.last_poll_timeout_message")).toBe("telegram poller timeout after 1010ms")
    } finally {
        db.close()
    }
})

test("telegram poller logs recovery after a timeout", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const logger = new MemoryLogger()
        let calls = 0
        const client = {
            async getUpdates(
                _offset: number | null,
                _timeoutSeconds: number,
                signal?: AbortSignal,
            ): Promise<TelegramUpdate[]> {
                calls += 1

                if (calls === 1) {
                    return await new Promise<TelegramUpdate[]>((_resolve, reject) => {
                        signal?.addEventListener("abort", () => {
                            reject(new DOMException("aborted", "AbortError"))
                        })
                    })
                }

                if (calls === 2) {
                    return []
                }

                throw new TelegramApiError("stop", false)
            },
        }

        const poller = new TelegramPollingService(
            client,
            new NoopMailbox(),
            store,
            logger,
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 1,
                allowedChats: [],
                allowedUsers: ["6212645712"],
            },
            new GatewayMailboxRouter([]),
            new NoopMediaStore(),
            new NoopQuestions(),
            {
                timeoutFloorMs: 10,
                timeoutGraceMs: 10,
                stallGraceMs: 10,
            },
        )

        poller.start()
        await waitFor(() =>
            logger.messages.some((entry) => entry.includes("telegram poller recovered after 1 consecutive failure(s)")),
        )
        await waitFor(() => !poller.isRunning())

        expect(poller.recoveryRecordedAtMs()).not.toBeNull()
    } finally {
        db.close()
    }
})

test("telegram poller logs ignored updates at debug level", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const logger = new MemoryLogger()
        let calls = 0
        const client = {
            async getUpdates(): Promise<TelegramUpdate[]> {
                calls += 1

                if (calls === 1) {
                    return [{ update_id: 1 }]
                }

                throw new TelegramApiError("stop", false)
            },
        }

        const poller = new TelegramPollingService(
            client,
            new NoopMailbox(),
            store,
            logger,
            {
                enabled: true,
                botToken: "secret",
                botTokenEnv: "TELEGRAM_BOT_TOKEN",
                pollTimeoutSeconds: 1,
                allowedChats: [],
                allowedUsers: ["6212645712"],
            },
            new GatewayMailboxRouter([]),
            new NoopMediaStore(),
            new NoopQuestions(),
            {
                timeoutFloorMs: 10,
                timeoutGraceMs: 10,
                stallGraceMs: 10,
            },
        )

        poller.start()
        await waitFor(() => !poller.isRunning())

        expect(
            logger.entries.some(
                (entry) => entry.level === "debug" && entry.message.includes("unsupported update type"),
            ),
        ).toBe(true)
        expect(
            logger.entries.some((entry) => entry.level === "info" && entry.message.includes("unsupported update type")),
        ).toBe(false)
    } finally {
        db.close()
    }
})

class NoopMailbox {
    async enqueueInboundMessage(_message: BindingInboundMessage): Promise<void> {}
}

class NoopMediaStore {
    async materializeInboundMessage(message: TelegramNormalizedInboundMessage): Promise<BindingInboundMessage> {
        return {
            mailboxKey: message.mailboxKey,
            deliveryTarget: message.deliveryTarget,
            sender: message.sender,
            text: message.text,
            attachments: [],
        }
    }
}

class NoopQuestions {
    async handleTelegramCallbackQuery(): Promise<boolean> {
        return true
    }
}

class MemoryLogger implements BindingLoggerHost {
    readonly entries: Array<{ level: string; message: string }> = []

    get messages(): string[] {
        return this.entries.map((entry) => entry.message)
    }

    log(level: string, message: string): void {
        this.entries.push({ level, message })
    }
}

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        if (predicate()) {
            return
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 10)
        })
    }

    throw new Error("condition was not met before timeout")
}
