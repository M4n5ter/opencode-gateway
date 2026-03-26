import { mkdir } from "node:fs/promises"
import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingModule, GatewayContract } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { GatewayCronRuntime } from "./cron/runtime"
import { TelegramProgressiveSupport } from "./delivery/telegram"
import { GatewayTextDelivery } from "./delivery/text"
import { ChannelFileSender } from "./host/file-sender"
import { ConsoleLoggerHost } from "./host/logger"
import { GatewayTransportHost } from "./host/transport"
import { createInteractionClient } from "./interactions/client"
import { GatewayInteractionRuntime } from "./interactions/runtime"
import { GatewayMailboxRouter } from "./mailbox/router"
import { GatewayMemoryPromptProvider } from "./memory/prompt"
import { GatewayMemoryRuntime } from "./memory/runtime"
import { OpencodeSdkAdapter } from "./opencode/adapter"
import { OpencodeEventStream } from "./opencode/event-stream"
import { OpencodeEventHub } from "./opencode/events"
import { GatewayExecutor } from "./runtime/executor"
import { GatewayMailboxRuntime } from "./runtime/mailbox"
import { getOrCreateRuntimeSingleton } from "./runtime/runtime-singleton"
import { GatewaySessionContext } from "./session/context"
import { resolveConversationKeyForTarget } from "./session/conversation-key"
import { ChannelSessionSwitcher } from "./session/switcher"
import { GatewaySystemPromptBuilder } from "./session/system-prompt"
import { openSqliteStore } from "./store/sqlite"
import { TelegramBotClient } from "./telegram/client"
import { TelegramInboundMediaStore } from "./telegram/media"
import { TelegramPollingService } from "./telegram/poller"
import { GatewayTelegramRuntime } from "./telegram/runtime"

export type GatewayPluginStatus = {
    runtimeMode: string
    supportsTelegram: boolean
    supportsCron: boolean
    hasWebUi: boolean
    cronTimezone: string
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
        readonly files: ChannelFileSender,
        readonly channelSessions: ChannelSessionSwitcher,
        readonly sessionContext: GatewaySessionContext,
        readonly systemPrompts: GatewaySystemPromptBuilder,
        readonly memory: GatewayMemoryRuntime,
    ) {}

    status(): GatewayPluginStatus {
        const rustStatus = this.contract.gatewayStatus()

        return {
            runtimeMode: rustStatus.runtimeMode,
            supportsTelegram: rustStatus.supportsTelegram,
            supportsCron: rustStatus.supportsCron,
            hasWebUi: rustStatus.hasWebUi,
            cronTimezone: this.cron.timeZone(),
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
    return await getOrCreateRuntimeSingleton(config.configPath, async () => {
        await mkdir(config.workspaceDirPath, { recursive: true })
        const logger = new ConsoleLoggerHost(config.logLevel)
        if (config.hasLegacyGatewayTimezone) {
            const suffix = config.legacyGatewayTimezone === null ? "" : ` (${config.legacyGatewayTimezone})`
            logger.log("warn", `gateway.timezone${suffix} is ignored; use cron.timezone instead`)
        }

        const effectiveCronTimeZone = resolveEffectiveCronTimeZone(module, config)
        const store = await openSqliteStore(config.stateDbPath)
        const sessionContext = new GatewaySessionContext(store)
        const memory = new GatewayMemoryRuntime(config.memory, logger)
        const memoryPrompts = new GatewayMemoryPromptProvider(config.memory, logger)
        const systemPrompts = new GatewaySystemPromptBuilder(sessionContext, memoryPrompts)
        const telegramClient = config.telegram.enabled ? new TelegramBotClient(config.telegram.botToken) : null
        const telegramMediaStore =
            config.telegram.enabled && telegramClient !== null
                ? new TelegramInboundMediaStore(telegramClient, config.mediaRootPath)
                : null
        const mailboxRouter = new GatewayMailboxRouter(config.mailbox.routes)
        const opencodeEvents = new OpencodeEventHub()
        const opencode = new OpencodeSdkAdapter(input.client, config.workspaceDirPath)
        const interactionClient = createInteractionClient(input.client, input.serverUrl, config.workspaceDirPath)
        const transport = new GatewayTransportHost(telegramClient, store)
        const files = new ChannelFileSender(telegramClient)
        const channelSessions = new ChannelSessionSwitcher(
            store,
            sessionContext,
            mailboxRouter,
            module,
            opencode,
            config.telegram.enabled,
        )
        const interactions = new GatewayInteractionRuntime(
            interactionClient,
            config.workspaceDirPath,
            store,
            sessionContext,
            transport,
            telegramClient,
            logger,
        )
        const progressiveSupport = new TelegramProgressiveSupport(telegramClient, store, logger)
        const delivery = new GatewayTextDelivery(transport, store, progressiveSupport)
        const executor = new GatewayExecutor(module, store, opencode, opencodeEvents, delivery, logger)
        const mailbox = new GatewayMailboxRuntime(executor, store, logger, config.mailbox, interactions)
        const cron = new GatewayCronRuntime(
            executor,
            module,
            store,
            logger,
            config.cron,
            effectiveCronTimeZone,
            (target) => resolveConversationKeyForTarget(target, mailboxRouter, module),
        )
        const eventStream = new OpencodeEventStream(
            input.client,
            config.workspaceDirPath,
            opencodeEvents,
            [interactions],
            logger,
        )
        const telegramPolling =
            config.telegram.enabled && telegramClient !== null && telegramMediaStore !== null
                ? new TelegramPollingService(
                      telegramClient,
                      mailbox,
                      store,
                      logger,
                      config.telegram,
                      mailboxRouter,
                      telegramMediaStore,
                      interactions,
                  )
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

        return new GatewayPluginRuntime(
            module,
            executor,
            cron,
            telegram,
            files,
            channelSessions,
            sessionContext,
            systemPrompts,
            memory,
        )
    })
}

function resolveEffectiveCronTimeZone(
    module: GatewayBindingModule,
    config: Awaited<ReturnType<typeof loadGatewayConfig>>,
): string {
    const candidate = config.cron.timezone ?? resolveRuntimeLocalTimeZone()
    return module.normalizeCronTimeZone(candidate)
}

function resolveRuntimeLocalTimeZone(): string {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
        throw new Error("runtime local time zone could not be determined")
    }

    return timeZone
}
