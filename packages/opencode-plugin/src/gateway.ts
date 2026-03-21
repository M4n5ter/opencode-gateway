import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingModule, GatewayContract } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { GatewayCronRuntime } from "./cron/runtime"
import { TelegramProgressiveSupport } from "./delivery/telegram"
import { GatewayTextDelivery } from "./delivery/text"
import { ConsoleLoggerHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"
import { GatewayTransportHost } from "./host/transport"
import { GatewayMailboxRouter } from "./mailbox/router"
import { OpencodeEventStream } from "./opencode/event-stream"
import { OpencodeEventHub } from "./opencode/events"
import { GatewayExecutor } from "./runtime/executor"
import { GatewayMailboxRuntime } from "./runtime/mailbox"
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
        readonly contract: GatewayContract,
        readonly executor: GatewayExecutor,
        readonly cron: GatewayCronRuntime,
        readonly telegram: GatewayTelegramRuntime,
    ) {}

    status(): GatewayPluginStatus {
        const rustStatus = this.contract.gatewayStatus()

        return {
            runtimeMode: rustStatus.runtimeMode,
            supportsTelegram: rustStatus.supportsTelegram,
            supportsCron: rustStatus.supportsCron,
            hasWebUi: rustStatus.hasWebUi,
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
    const mailboxRouter = new GatewayMailboxRouter(config.mailbox.routes)
    const opencodeEvents = new OpencodeEventHub()
    const opencode = new GatewayOpencodeHost(input.client, input.directory, opencodeEvents)
    const transport = new GatewayTransportHost(telegramClient, store)
    const progressiveSupport = new TelegramProgressiveSupport(telegramClient, store, logger)
    const delivery = new GatewayTextDelivery(transport, store, progressiveSupport)
    const executor = new GatewayExecutor(module, store, opencode, delivery, logger)
    const mailbox = new GatewayMailboxRuntime(executor, store, logger, config.mailbox)
    const cron = new GatewayCronRuntime(executor, module, store, logger, config.cron)
    const eventStream = new OpencodeEventStream(input.client, input.directory, opencodeEvents, logger)
    const telegramPolling =
        config.telegram.enabled && telegramClient !== null
            ? new TelegramPollingService(telegramClient, mailbox, store, logger, config.telegram, mailboxRouter)
            : null
    const telegram = new GatewayTelegramRuntime(
        telegramClient,
        delivery,
        store,
        logger,
        config.telegram,
        telegramPolling,
        eventStream,
    )
    eventStream.start()
    cron.start()
    mailbox.start()
    telegram.start()

    return new GatewayPluginRuntime(module, executor, cron, telegram)
}
