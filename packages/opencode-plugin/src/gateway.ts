import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayBindingModule } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { GatewayCronRuntime } from "./cron/runtime"
import { ConsoleLoggerHost, SystemClockHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"
import { SqliteStoreHost } from "./host/store"
import { GatewayTransportHost } from "./host/transport"
import { GatewayExecutor } from "./runtime/executor"
import { openSqliteStore } from "./store/sqlite"
import { TelegramBotClient } from "./telegram/client"
import { TelegramPollingService } from "./telegram/poller"
import { GatewayTelegramRuntime } from "./telegram/runtime"

export type GatewayPluginStatus = {
    runtimeMode: string
    supportsTelegram: boolean
    supportsCron: boolean
    hasWebUi: boolean
    cronEnabled: boolean
    cronPolling: boolean
    cronRunningJobs: number
    telegramEnabled: boolean
    telegramPolling: boolean
    telegramAllowlistMode: "disabled" | "explicit"
}

const RUST_CONTRACT_STATUS_SNAPSHOT = {
    runtimeMode: "contract",
    supportsTelegram: true,
    supportsCron: true,
    hasWebUi: false,
} as const

export class GatewayPluginRuntime {
    constructor(
        readonly binding: GatewayBindingHandle,
        readonly executor: GatewayExecutor,
        readonly cron: GatewayCronRuntime,
        readonly telegram: GatewayTelegramRuntime,
    ) {}

    status(): GatewayPluginStatus {
        return {
            runtimeMode: RUST_CONTRACT_STATUS_SNAPSHOT.runtimeMode,
            supportsTelegram: RUST_CONTRACT_STATUS_SNAPSHOT.supportsTelegram,
            supportsCron: RUST_CONTRACT_STATUS_SNAPSHOT.supportsCron,
            hasWebUi: RUST_CONTRACT_STATUS_SNAPSHOT.hasWebUi,
            cronEnabled: this.cron.isEnabled(),
            cronPolling: this.cron.isRunning(),
            cronRunningJobs: this.cron.runningJobs(),
            telegramEnabled: this.telegram.isEnabled(),
            telegramPolling: this.telegram.isPolling(),
            telegramAllowlistMode: this.telegram.allowlistMode(),
        }
    }
}

export async function createGatewayRuntime(
    module: GatewayBindingModule,
    input: PluginInput,
): Promise<GatewayPluginRuntime> {
    const config = await loadGatewayConfig()
    const store = await openSqliteStore(config.stateDbPath)
    const logger = new ConsoleLoggerHost()
    const telegramClient = config.telegram.enabled ? new TelegramBotClient(config.telegram.botToken) : null
    const opencode = new GatewayOpencodeHost(input.client, input.directory)
    const transport = new GatewayTransportHost(telegramClient, store)

    const binding = module.GatewayBinding.new(
        new SqliteStoreHost(store),
        opencode,
        transport,
        new SystemClockHost(),
        logger,
    )
    const executor = new GatewayExecutor(store, opencode, transport, logger)
    const cron = new GatewayCronRuntime(executor, binding, store, logger, config.cron)

    const telegramPolling =
        config.telegram.enabled && telegramClient !== null
            ? new TelegramPollingService(telegramClient, executor, store, logger, config.telegram)
            : null
    const telegram = new GatewayTelegramRuntime(telegramClient, store, logger, config.telegram, telegramPolling)
    cron.start()
    telegram.start()

    return new GatewayPluginRuntime(binding, executor, cron, telegram)
}
