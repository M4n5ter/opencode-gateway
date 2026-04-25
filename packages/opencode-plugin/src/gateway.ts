import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingModule, GatewayContract } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { resolveGatewayConfigPath, resolveGatewayWorkspacePath } from "./config/paths"
import { GatewayCronRuntime } from "./cron/runtime"
import { TelegramProgressiveSupport } from "./delivery/telegram"
import { GatewayTextDelivery } from "./delivery/text"
import { ChannelFileSender } from "./host/file-sender"
import { ConsoleLoggerHost } from "./host/logger"
import { GatewayTransportHost } from "./host/transport"
import { createGatewayFetch } from "./http/proxy"
import { createInteractionClient } from "./interactions/client"
import { GatewayInteractionRuntime } from "./interactions/runtime"
import { GatewayMailboxRouter } from "./mailbox/router"
import { GatewayMemoryPromptProvider } from "./memory/prompt"
import { GatewayMemoryRuntime } from "./memory/runtime"
import { OpencodeSdkAdapter } from "./opencode/adapter"
import { OpencodeEventStream } from "./opencode/event-stream"
import { OpencodeEventHub } from "./opencode/events"
import { ActiveExecutionRegistry } from "./runtime/active-execution"
import { GatewayExecutor } from "./runtime/executor"
import { GatewayInflightPolicyRuntime } from "./runtime/inflight-policy"
import { GatewayMailboxRuntime } from "./runtime/mailbox"
import { GatewayRestartRuntime, type GatewayRestartStatus } from "./runtime/restart"
import { getOrCreateRuntimeSingleton } from "./runtime/runtime-singleton"
import { GatewayToolActivityRuntime } from "./runtime/tool-activity"
import { GatewaySessionAgentRuntime } from "./session/agent"
import { GatewaySessionContext } from "./session/context"
import { resolveConversationKeyForTarget } from "./session/conversation-key"
import { GatewaySessionSearchRuntime } from "./session/search"
import { ChannelSessionSwitcher } from "./session/switcher"
import { GatewaySystemPromptBuilder } from "./session/system-prompt"
import { openSqliteStore } from "./store/sqlite"
import { TelegramMessageCleanupRuntime } from "./telegram/cleanup"
import { TelegramBotClient } from "./telegram/client"
import { GatewayTelegramCompactionRuntime } from "./telegram/compaction"
import { TelegramInboundMediaStore } from "./telegram/media"
import { TelegramPollingService } from "./telegram/poller"
import { GatewayTelegramRuntime } from "./telegram/runtime"
import { TelegramToolToggleRuntime } from "./telegram/tool-toggle"
import { ensureGatewayWorkspaceScaffold } from "./workspace/scaffold"

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
    restartSupported: boolean
    restartManaged: boolean
    restartState: GatewayRestartStatus["state"]
    restartPending: boolean
    restartRequestedAtMs: number | null
    restartCompletedAtMs: number | null
    restartLastError: string | null
}

export class GatewayPluginRuntime {
    constructor(
        readonly contract: GatewayContract,
        readonly executor: GatewayExecutor,
        readonly cron: GatewayCronRuntime,
        readonly telegram: GatewayTelegramRuntime,
        readonly files: ChannelFileSender,
        readonly channelSessions: ChannelSessionSwitcher,
        readonly sessionAgents: GatewaySessionAgentRuntime,
        readonly sessionSearch: GatewaySessionSearchRuntime,
        readonly sessionContext: GatewaySessionContext,
        readonly restart: GatewayRestartRuntime,
        readonly systemPrompts: GatewaySystemPromptBuilder,
        readonly memory: GatewayMemoryRuntime,
    ) {}

    async status(): Promise<GatewayPluginStatus> {
        const rustStatus = this.contract.gatewayStatus()
        const restartStatus = await this.restart.status()

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
            restartSupported: restartStatus.supported,
            restartManaged: restartStatus.managed,
            restartState: restartStatus.state,
            restartPending: restartStatus.pending,
            restartRequestedAtMs: restartStatus.requestedAtMs,
            restartCompletedAtMs: restartStatus.completedAtMs,
            restartLastError: restartStatus.lastError,
        }
    }
}

export async function createGatewayRuntime(
    module: GatewayBindingModule,
    input: PluginInput,
): Promise<GatewayPluginRuntime> {
    await ensureGatewayWorkspaceScaffold(resolveGatewayWorkspacePath(resolveGatewayConfigPath(process.env)))
    const config = await loadGatewayConfig()
    return await getOrCreateRuntimeSingleton(
        config.configPath,
        async () => {
            await ensureGatewayWorkspaceScaffold(config.workspaceDirPath)
            const logger = new ConsoleLoggerHost(config.logLevel)
            const restart = GatewayRestartRuntime.fromEnvironment(process.env)
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
            const telegramClient = config.telegram.enabled
                ? new TelegramBotClient(
                      config.telegram.botToken,
                      await createGatewayFetch(config.httpProxy, process.env, logger),
                  )
                : null
            const telegramMediaStore =
                config.telegram.enabled && telegramClient !== null
                    ? new TelegramInboundMediaStore(telegramClient, config.mediaRootPath)
                    : null
            const mailboxRouter = new GatewayMailboxRouter(config.mailbox.routes)
            const opencodeEvents = new OpencodeEventHub()
            const activeExecutions = new ActiveExecutionRegistry()
            const opencode = new OpencodeSdkAdapter(input.client, config.workspaceDirPath)
            const sessionAgents = new GatewaySessionAgentRuntime(opencode, sessionContext, store)
            const sessionSearch = new GatewaySessionSearchRuntime(store, opencode)
            const interactionClient = createInteractionClient(input.client, input.serverUrl, config.workspaceDirPath)
            const compactionReactions = new GatewayTelegramCompactionRuntime(
                telegramClient,
                interactionClient,
                config.workspaceDirPath,
                store,
                sessionContext,
                logger,
                config.telegram,
            )
            const transport = new GatewayTransportHost(
                telegramClient,
                store,
                config.telegram.enabled ? config.telegram.ux.toolCallView : "off",
                compactionReactions,
            )
            const files = new ChannelFileSender(telegramClient)
            const channelSessions = new ChannelSessionSwitcher(
                store,
                sessionContext,
                mailboxRouter,
                module,
                opencode,
                config.telegram.enabled,
            )
            const cleanup = new TelegramMessageCleanupRuntime(telegramClient, store, logger)
            const progressiveSupport = new TelegramProgressiveSupport(telegramClient, store, logger)
            const delivery = new GatewayTextDelivery(
                transport,
                store,
                progressiveSupport,
                config.telegram.enabled ? config.telegram.ux.toolCallView : "off",
                undefined,
                compactionReactions,
            )
            const toolActivity = new GatewayToolActivityRuntime(
                interactionClient,
                config.workspaceDirPath,
                sessionContext,
                logger,
                config.telegram,
            )
            const toolToggle = new TelegramToolToggleRuntime(
                telegramClient,
                store,
                config.telegram.enabled ? config.telegram.ux.toolCallView : "off",
            )
            const executor = new GatewayExecutor(
                module,
                store,
                opencode,
                opencodeEvents,
                delivery,
                logger,
                config.execution,
                undefined,
                toolActivity,
                activeExecutions,
                sessionAgents,
                restart,
            )
            let notifyMailboxStateChanged = (): void => {}
            const inflightRuntime = new GatewayInflightPolicyRuntime(store, executor, logger, () => {
                notifyMailboxStateChanged()
            })
            const interactions = new GatewayInteractionRuntime(
                interactionClient,
                config.workspaceDirPath,
                store,
                sessionContext,
                transport,
                telegramClient,
                logger,
                inflightRuntime,
            )
            const mailbox = new GatewayMailboxRuntime(
                executor,
                transport,
                store,
                logger,
                config.mailbox,
                interactions,
                config.inflightMessages,
                inflightRuntime,
                restart,
            )
            notifyMailboxStateChanged = () => {
                mailbox.scheduleDrainNow()
            }
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
                [activeExecutions, interactions, toolActivity, compactionReactions],
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
                          [toolToggle, interactions],
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
            cleanup.start()
            setTimeout(() => {
                void interactions.reconcilePendingRequests().catch((error) => {
                    logger.log("warn", `interaction reconcile failed during startup: ${String(error)}`)
                })
            }, 0)

            return new GatewayPluginRuntime(
                module,
                executor,
                cron,
                telegram,
                files,
                channelSessions,
                sessionAgents,
                sessionSearch,
                sessionContext,
                restart,
                systemPrompts,
                memory,
            )
        },
        {
            isReusable: isGatewayPluginRuntimeCompatible,
        },
    )
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

function isGatewayPluginRuntimeCompatible(value: unknown): value is GatewayPluginRuntime {
    if (typeof value !== "object" || value === null) {
        return false
    }

    const candidate = value as Record<string, unknown>
    const sessionSearch = candidate.sessionSearch
    return (
        typeof candidate.status === "function" &&
        hasMethod(candidate.cron, "isEnabled") &&
        hasMethod(candidate.telegram, "isEnabled") &&
        hasMethod(candidate.files, "hasEnabledChannel") &&
        hasMethod(candidate.channelSessions, "hasEnabledChannel") &&
        hasMethod(candidate.sessionAgents, "status") &&
        hasMethod(sessionSearch, "list") &&
        hasMethod(sessionSearch, "search") &&
        hasMethod(sessionSearch, "view") &&
        hasMethod(candidate.restart, "status") &&
        hasMethod(candidate.systemPrompts, "buildPrompts") &&
        hasMethod(candidate.memory, "hasEntries")
    )
}

function hasMethod(value: unknown, methodName: string): boolean {
    if (typeof value !== "object" || value === null) {
        return false
    }

    return typeof (value as Record<string, unknown>)[methodName] === "function"
}
