import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayBindingModule } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { GatewayCronRuntime } from "./cron/runtime"
import { ConsoleLoggerHost, SystemClockHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"
import { SqliteStoreHost } from "./host/store"
import { GatewayTransportHost } from "./host/transport"
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

export class GatewayPluginRuntime {
    constructor(
        readonly binding: GatewayBindingHandle,
        readonly cron: GatewayCronRuntime,
        readonly telegram: GatewayTelegramRuntime,
    ) {}

    status(): GatewayPluginStatus {
        const status = this.binding.status()

        return {
            runtimeMode: status.runtimeMode,
            supportsTelegram: status.supportsTelegram,
            supportsCron: status.supportsCron,
            hasWebUi: status.hasWebUi,
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

    const binding = module.GatewayBinding.new(
        new SqliteStoreHost(store),
        new GatewayOpencodeHost(input.client, input.directory),
        new GatewayTransportHost(telegramClient, store),
        new SystemClockHost(),
        logger,
    )
    const cron = new GatewayCronRuntime(binding, store, logger, config.cron)

    const telegramPolling =
        config.telegram.enabled && telegramClient !== null
            ? new TelegramPollingService(telegramClient, binding, store, logger, config.telegram)
            : null
    const telegram = new GatewayTelegramRuntime(telegramClient, store, logger, config.telegram, telegramPolling)
    cron.start()
    telegram.start()

    return new GatewayPluginRuntime(binding, cron, telegram)
}
