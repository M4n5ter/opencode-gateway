import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayBindingModule } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { ConsoleLoggerHost, SystemClockHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"
import { SqliteStoreHost } from "./host/store"
import { GatewayTransportHost } from "./host/transport"
import { openSqliteStore } from "./store/sqlite"
import { TelegramBotClient } from "./telegram/client"
import { TelegramPollingService } from "./telegram/poller"

export type GatewayPluginStatus = {
    runtimeMode: string
    supportsTelegram: boolean
    supportsCron: boolean
    hasWebUi: boolean
    telegramEnabled: boolean
    telegramPolling: boolean
    telegramAllowlistMode: "disabled" | "explicit"
}

export class GatewayPluginRuntime {
    constructor(
        readonly binding: GatewayBindingHandle,
        private readonly telegramPolling: TelegramPollingService | null,
    ) {}

    status(): GatewayPluginStatus {
        const status = this.binding.status()

        return {
            runtimeMode: status.runtimeMode,
            supportsTelegram: status.supportsTelegram,
            supportsCron: status.supportsCron,
            hasWebUi: status.hasWebUi,
            telegramEnabled: this.telegramPolling !== null,
            telegramPolling: this.telegramPolling?.isRunning() ?? false,
            telegramAllowlistMode: this.telegramPolling === null ? "disabled" : "explicit",
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
        new GatewayTransportHost(telegramClient),
        new SystemClockHost(),
        logger,
    )

    const telegramPolling =
        config.telegram.enabled && telegramClient !== null
            ? new TelegramPollingService(telegramClient, binding, store, logger, config.telegram)
            : null
    telegramPolling?.start()

    return new GatewayPluginRuntime(binding, telegramPolling)
}
