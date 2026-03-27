import type { BindingDeliveryTarget, BindingLoggerHost } from "../binding"
import type { TelegramConfig } from "../config/telegram"
import type { OpencodeRuntimeEvent } from "../opencode/events"
import type { GatewaySessionContext } from "../session/context"
import { type GatewaySessionHierarchyClientLike, GatewaySessionHierarchyResolver } from "../session/hierarchy"
import type { TelegramToolSection } from "../telegram/tool-render"
import { formatError } from "../utils/error"

type ToolActivityClientLike = GatewaySessionHierarchyClientLike

export type GatewayToolActivityHandle = {
    trackSession(sessionId: string): void
    finish(_recordedAtMs: number): Promise<void>
}

type ToolSectionsChangedHandler = (sections: TelegramToolSection[]) => Promise<void> | void

type ToolEventState =
    | {
          status: "pending"
          input?: unknown
          raw?: string
      }
    | {
          status: "running"
          input?: unknown
          title?: string
      }
    | {
          status: "completed"
          input?: unknown
          title?: string
          output?: string
      }
    | {
          status: "error"
          input?: unknown
          error?: string
      }

type ToolPartUpdatedEvent = {
    type: "message.part.updated"
    properties: {
        part: {
            id: string
            sessionID: string
            messageID: string
            type: "tool"
            callID: string
            tool: string
            state: ToolEventState
        }
    }
}

type NormalizedToolEvent = {
    sessionId: string
    callId: string
    section: TelegramToolSection
}

export class GatewayToolActivityRuntime {
    private readonly hierarchy: GatewaySessionHierarchyResolver
    private readonly sessionContexts = new Map<string, ExecutionToolContext>()
    private readonly activeContexts = new Set<ExecutionToolContext>()
    private readonly enabled: boolean

    constructor(
        client: ToolActivityClientLike,
        directory: string,
        sessions: GatewaySessionContext,
        private readonly logger: BindingLoggerHost,
        telegram: TelegramConfig,
    ) {
        this.hierarchy = new GatewaySessionHierarchyResolver(client, directory, sessions, logger)
        this.enabled = telegram.enabled && telegram.ux.toolCallView !== "off"
    }

    beginExecution(
        replyTargets: BindingDeliveryTarget[],
        onSectionsChanged: ToolSectionsChangedHandler,
    ): GatewayToolActivityHandle | null {
        if (!this.enabled || !replyTargets.some((target) => target.channel === "telegram")) {
            return null
        }

        const context = new ExecutionToolContext(onSectionsChanged)
        this.activeContexts.add(context)

        return {
            trackSession: (sessionId) => {
                this.attachSession(context, sessionId)
            },
            finish: async (_recordedAtMs) => {
                this.detachContext(context)
            },
        }
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        if (!this.enabled || this.activeContexts.size === 0) {
            return
        }

        const normalized = normalizeToolEvent(event)
        if (normalized === null) {
            return
        }

        void this.processToolEvent(normalized).catch((error) => {
            this.logger.log("warn", `tool activity bridge failed: ${formatError(error)}`)
        })
    }

    private async processToolEvent(event: NormalizedToolEvent): Promise<void> {
        const context = await this.resolveContext(event.sessionId)
        if (context === null) {
            return
        }

        await context.updateSection(event.callId, event.section)
    }

    private async resolveContext(sessionId: string): Promise<ExecutionToolContext | null> {
        const directContext = this.sessionContexts.get(sessionId)
        if (directContext !== undefined) {
            return directContext
        }

        const ancestorSessionId = await this.hierarchy.findAncestor(sessionId, (candidateSessionId) => {
            return this.sessionContexts.has(candidateSessionId)
        })
        if (ancestorSessionId === null) {
            return null
        }

        const context = this.sessionContexts.get(ancestorSessionId) ?? null
        if (context !== null) {
            this.attachSession(context, sessionId)
        }

        return context
    }

    private attachSession(context: ExecutionToolContext, sessionId: string): void {
        const existing = this.sessionContexts.get(sessionId)
        if (existing === context) {
            return
        }

        if (existing !== undefined) {
            existing.detachSession(sessionId)
        }

        context.attachSession(sessionId)
        this.sessionContexts.set(sessionId, context)
    }

    private detachContext(context: ExecutionToolContext): void {
        this.activeContexts.delete(context)
        for (const sessionId of context.listSessions()) {
            if (this.sessionContexts.get(sessionId) === context) {
                this.sessionContexts.delete(sessionId)
            }
        }
    }
}

class ExecutionToolContext {
    private readonly sessions = new Set<string>()
    private readonly orderedCallIds: string[] = []
    private readonly sections = new Map<string, TelegramToolSection>()
    private pendingWork = Promise.resolve()

    constructor(private readonly onSectionsChanged: ToolSectionsChangedHandler) {}

    attachSession(sessionId: string): void {
        this.sessions.add(sessionId)
    }

    detachSession(sessionId: string): void {
        this.sessions.delete(sessionId)
    }

    listSessions(): string[] {
        return [...this.sessions]
    }

    async updateSection(callId: string, section: TelegramToolSection): Promise<void> {
        if (!this.sections.has(callId)) {
            this.orderedCallIds.push(callId)
        }

        this.sections.set(callId, section)
        await this.enqueueNotify()
    }

    private async enqueueNotify(): Promise<void> {
        const run = async (): Promise<void> => {
            await this.onSectionsChanged(
                this.orderedCallIds
                    .map((callId) => this.sections.get(callId) ?? null)
                    .filter((section): section is TelegramToolSection => section !== null),
            )
        }

        this.pendingWork = this.pendingWork.then(run, run)
        await this.pendingWork
    }
}

function normalizeToolEvent(event: OpencodeRuntimeEvent): NormalizedToolEvent | null {
    if (!isToolPartUpdatedEvent(event)) {
        return null
    }

    const part = event.properties.part
    return {
        sessionId: part.sessionID,
        callId: part.callID,
        section: {
            callId: part.callID,
            toolName: part.tool,
            status: part.state.status,
            title: readToolTitle(part.state),
            inputText: readToolInput(part.state),
            outputText: part.state.status === "completed" ? normalizeText(part.state.output) : null,
            errorText: part.state.status === "error" ? normalizeText(part.state.error) : null,
        },
    }
}

function isToolPartUpdatedEvent(event: OpencodeRuntimeEvent): event is ToolPartUpdatedEvent {
    if (event.type !== "message.part.updated" || typeof event.properties !== "object" || event.properties === null) {
        return false
    }

    const part = "part" in event.properties ? event.properties.part : null
    return typeof part === "object" && part !== null && "type" in part && part.type === "tool"
}

function readToolTitle(state: ToolEventState): string | null {
    if ("title" in state) {
        return normalizeText(state.title)
    }

    return null
}

function readToolInput(state: ToolEventState): string | null {
    if (state.status === "pending") {
        return normalizeText(state.raw) ?? stringifyUnknown(state.input)
    }

    return stringifyUnknown(state.input)
}

function stringifyUnknown(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null
    }

    if (typeof value === "string") {
        return normalizeText(value)
    }

    try {
        return normalizeText(JSON.stringify(value, null, 2))
    } catch {
        return normalizeText(String(value))
    }
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
}
