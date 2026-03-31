import type {
    OpencodeSdkAdapter,
    OpencodeSessionMessageRecord,
} from "../opencode/adapter"
import type { GatewaySessionCatalogRecord, SqliteStore } from "../store/sqlite"

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 50
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_SEARCH_MESSAGE_LIMIT = 400
const MAX_SEARCH_MESSAGE_LIMIT = 1000
const DEFAULT_VIEW_MESSAGE_LIMIT = 40
const MAX_VIEW_MESSAGE_LIMIT = 200
const DEFAULT_VIEW_OFFSET = 0
const SEARCH_SNIPPET_LIMIT = 180
const VIEW_BODY_LIMIT = 4_000

type UnknownRecord = Record<string, unknown>

type GatewayActiveSessionRecord = GatewaySessionCatalogRecord & {
    title: string
    createdAtMs: number
    updatedAtMs: number
    parentId: string | null
}

export type GatewaySessionSearchOptions = {
    sessionId?: string | null
    limit?: number | null
    messageLimit?: number | null
}

export type GatewaySessionSearchHit = {
    sessionId: string
    conversationKey: string
    sessionTitle: string
    sessionCreatedAtMs: number
    sessionUpdatedAtMs: number
    messageId: string
    role: string
    partType: string
    matchedField: string
    matchedAtMs: number | null
    snippet: string
}

export type GatewaySessionSearchResult = {
    query: string
    scannedSessions: number
    skippedDeletedSessionIds: string[]
    maybeTruncatedSessionIds: string[]
    hits: GatewaySessionSearchHit[]
}

export type GatewaySessionListOptions = {
    offset?: number | null
    limit?: number | null
    includeDeleted?: boolean | null
}

export type GatewaySessionListEntry = {
    sessionId: string
    conversationKey: string
    status: "active" | "deleted"
    isCurrentBinding: boolean
    lastTrackedAtMs: number
    sessionTitle: string | null
    parentSessionId: string | null
    sessionCreatedAtMs: number | null
    sessionUpdatedAtMs: number | null
}

export type GatewaySessionListResult = {
    offset: number
    limit: number
    returnedCount: number
    totalCount: number
    nextOffset: number | null
    prevOffset: number | null
    activeCount: number
    deletedCount: number
    sessions: GatewaySessionListEntry[]
}

export type GatewaySessionViewOptions = {
    sessionId?: string | null
    offset?: number | null
    messageLimit?: number | null
    includeReasoning?: boolean | null
    includeAttachments?: boolean | null
    includeTools?: boolean | null
    includeToolInputs?: boolean | null
    includeToolOutputs?: boolean | null
    includeFiles?: boolean | null
    includeSubtasks?: boolean | null
    includeSnapshots?: boolean | null
    includePatches?: boolean | null
    includeSteps?: boolean | null
    includeCompactions?: boolean | null
    includeRetries?: boolean | null
    includeAgentParts?: boolean | null
}

export type GatewaySessionViewPart = {
    type: string
    summary: string
    body: string | null
}

export type GatewaySessionViewMessage = {
    messageId: string
    role: string
    parentId: string | null
    createdAtMs: number | null
    visiblePartTypes: string[]
    parts: GatewaySessionViewPart[]
}

export type GatewaySessionViewResult = {
    sessionId: string
    conversationKey: string
    sessionTitle: string
    parentSessionId: string | null
    sessionCreatedAtMs: number
    sessionUpdatedAtMs: number
    totalMessageCount: number
    offset: number
    messageLimit: number
    returnedCount: number
    nextOffset: number | null
    prevOffset: number | null
    visibleParts: string[]
    messages: GatewaySessionViewMessage[]
}

type NormalizedGatewaySessionViewOptions = {
    offset: number
    messageLimit: number
    includeReasoning: boolean
    includeAttachments: boolean
    includeTools: boolean
    includeToolInputs: boolean
    includeToolOutputs: boolean
    includeFiles: boolean
    includeSubtasks: boolean
    includeSnapshots: boolean
    includePatches: boolean
    includeSteps: boolean
    includeCompactions: boolean
    includeRetries: boolean
    includeAgentParts: boolean
}

type SearchField = {
    partType: string
    matchedField: string
    text: string
}

export class GatewaySessionSearchRuntime {
    constructor(
        private readonly store: Pick<SqliteStore, "listGatewaySessions" | "hasGatewaySession" | "getConversationKeyForSession">,
        private readonly opencode: Pick<OpencodeSdkAdapter, "listSessions" | "getSession" | "listSessionMessages">,
    ) {}

    async list(options: GatewaySessionListOptions = {}): Promise<GatewaySessionListResult> {
        const normalizedLimit = normalizePositiveInteger(options.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, "limit")
        const normalizedOffset = normalizeNonNegativeInteger(options.offset, DEFAULT_VIEW_OFFSET, "offset")
        const includeDeleted = options.includeDeleted ?? false
        const trackedCatalog = this.store.listGatewaySessions()
        const inventory = await this.resolveSessionInventory(trackedCatalog)
        const activeById = new Map(inventory.activeSessions.map((session) => [session.sessionId, session]))
        const sessions: GatewaySessionListEntry[] = []

        for (const tracked of trackedCatalog) {
            const active = activeById.get(tracked.sessionId)
            if (active !== undefined) {
                sessions.push({
                    sessionId: tracked.sessionId,
                    conversationKey: tracked.conversationKey,
                    status: "active",
                    isCurrentBinding: tracked.isCurrentBinding,
                    lastTrackedAtMs: tracked.lastTrackedAtMs,
                    sessionTitle: active.title,
                    parentSessionId: active.parentId,
                    sessionCreatedAtMs: active.createdAtMs,
                    sessionUpdatedAtMs: active.updatedAtMs,
                })
                continue
            }

            if (!includeDeleted) {
                continue
            }

            sessions.push({
                sessionId: tracked.sessionId,
                conversationKey: tracked.conversationKey,
                status: "deleted",
                isCurrentBinding: tracked.isCurrentBinding,
                lastTrackedAtMs: tracked.lastTrackedAtMs,
                sessionTitle: null,
                parentSessionId: null,
                sessionCreatedAtMs: null,
                sessionUpdatedAtMs: null,
            })
        }
        const offset = Math.min(normalizedOffset, sessions.length)
        const slicedSessions = sessions.slice(offset, offset + normalizedLimit)

        return {
            offset,
            limit: normalizedLimit,
            returnedCount: slicedSessions.length,
            totalCount: sessions.length,
            nextOffset: offset + slicedSessions.length < sessions.length ? offset + slicedSessions.length : null,
            prevOffset: offset > 0 ? Math.max(0, offset - normalizedLimit) : null,
            activeCount: inventory.activeSessions.length,
            deletedCount: inventory.skippedDeletedSessionIds.length,
            sessions: slicedSessions,
        }
    }

    async search(query: string, options: GatewaySessionSearchOptions = {}): Promise<GatewaySessionSearchResult> {
        const normalizedQuery = normalizeRequiredQuery(query)
        const normalizedLimit = normalizePositiveInteger(options.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, "limit")
        const normalizedMessageLimit = normalizePositiveInteger(
            options.messageLimit,
            DEFAULT_SEARCH_MESSAGE_LIMIT,
            MAX_SEARCH_MESSAGE_LIMIT,
            "message_limit",
        )
        const requestedSessionId = normalizeOptionalSessionId(options.sessionId)
        const trackedCatalog =
            requestedSessionId === null ? this.store.listGatewaySessions() : this.filterCatalogForSession(requestedSessionId)
        const {
            activeSessions: catalog,
            skippedDeletedSessionIds,
        } = await this.resolveSessionInventory(trackedCatalog)
        const hits: GatewaySessionSearchHit[] = []
        const maybeTruncatedSessionIds: string[] = []

        for (const session of catalog) {
            const messages = sortSessionMessages(await this.opencode.listSessionMessages(session.sessionId, normalizedMessageLimit))
            if (messages.length >= normalizedMessageLimit) {
                maybeTruncatedSessionIds.push(session.sessionId)
            }

            for (const message of messages) {
                for (const field of collectMessageSearchFields(message)) {
                    const matchIndex = field.text.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase())
                    if (matchIndex < 0) {
                        continue
                    }

                    hits.push({
                        sessionId: session.sessionId,
                        conversationKey: session.conversationKey,
                        sessionTitle: session.title,
                        sessionCreatedAtMs: session.createdAtMs,
                        sessionUpdatedAtMs: session.updatedAtMs,
                        messageId: message.messageId,
                        role: message.role,
                        partType: field.partType,
                        matchedField: field.matchedField,
                        matchedAtMs: message.createdAtMs,
                        snippet: createSnippet(field.text, matchIndex, normalizedQuery.length),
                    })
                }
            }
        }

        hits.sort(compareSearchHits)

        return {
            query: normalizedQuery,
            scannedSessions: catalog.length,
            skippedDeletedSessionIds: uniqueStrings(skippedDeletedSessionIds),
            maybeTruncatedSessionIds: uniqueStrings(maybeTruncatedSessionIds),
            hits: hits.slice(0, normalizedLimit),
        }
    }

    async view(options: GatewaySessionViewOptions = {}): Promise<GatewaySessionViewResult> {
        const sessionId = normalizeRequiredSessionId(options.sessionId)
        if (!this.store.hasGatewaySession(sessionId)) {
            throw new Error("requested session is not managed by the gateway")
        }

        const session = await this.opencode.getSession(sessionId)
        if (session === null) {
            throw new Error(`gateway-managed session no longer exists in OpenCode: ${sessionId}`)
        }

        const normalizedOptions = normalizeViewOptions(options)
        const messages = sortSessionMessages(await this.opencode.listSessionMessages(sessionId))
        const totalMessageCount = messages.length
        const offset = Math.min(normalizedOptions.offset, totalMessageCount)
        const slicedMessages = messages.slice(offset, offset + normalizedOptions.messageLimit)
        const visibleParts = collectVisibleParts(normalizedOptions)

        return {
            sessionId,
            conversationKey: this.store.getConversationKeyForSession(sessionId) ?? "unknown",
            sessionTitle: session.title,
            parentSessionId: session.parentId,
            sessionCreatedAtMs: session.createdAtMs,
            sessionUpdatedAtMs: session.updatedAtMs,
            totalMessageCount,
            offset,
            messageLimit: normalizedOptions.messageLimit,
            returnedCount: slicedMessages.length,
            nextOffset: offset + slicedMessages.length < totalMessageCount ? offset + slicedMessages.length : null,
            prevOffset: offset > 0 ? Math.max(0, offset - normalizedOptions.messageLimit) : null,
            visibleParts,
            messages: slicedMessages.map((message) => renderViewMessage(message, normalizedOptions)),
        }
    }

    private async resolveSessionInventory(catalog: GatewaySessionCatalogRecord[]): Promise<{
        activeSessions: GatewayActiveSessionRecord[]
        skippedDeletedSessionIds: string[]
    }> {
        const listedSessions = new Map((await this.opencode.listSessions()).map((record) => [record.id, record]))
        const activeSessions: GatewayActiveSessionRecord[] = []
        const skippedDeletedSessionIds: string[] = []

        for (const tracked of catalog) {
            const session = listedSessions.get(tracked.sessionId) ?? (await this.opencode.getSession(tracked.sessionId))
            if (session === null) {
                skippedDeletedSessionIds.push(tracked.sessionId)
                continue
            }

            activeSessions.push({
                ...tracked,
                title: session.title,
                createdAtMs: session.createdAtMs,
                updatedAtMs: session.updatedAtMs,
                parentId: session.parentId,
            })
        }

        return {
            activeSessions,
            skippedDeletedSessionIds,
        }
    }

    private filterCatalogForSession(sessionId: string): GatewaySessionCatalogRecord[] {
        if (!this.store.hasGatewaySession(sessionId)) {
            throw new Error("requested session is not managed by the gateway")
        }

        const matching = this.store.listGatewaySessions().filter((record) => record.sessionId === sessionId)
        if (matching.length > 0) {
            return matching
        }

        return [
            {
                sessionId,
                conversationKey: this.store.getConversationKeyForSession(sessionId) ?? "unknown",
                lastTrackedAtMs: 0,
                isCurrentBinding: false,
            },
        ]
    }
}

function renderViewMessage(
    message: OpencodeSessionMessageRecord,
    options: NormalizedGatewaySessionViewOptions,
): GatewaySessionViewMessage {
    const parts = message.parts.flatMap((part) => renderViewPart(asRecord(part), options))

    return {
        messageId: message.messageId,
        role: message.role,
        parentId: message.parentId,
        createdAtMs: message.createdAtMs,
        visiblePartTypes: uniqueStrings(parts.map((part) => part.type)),
        parts,
    }
}

function renderViewPart(
    part: UnknownRecord | null,
    options: NormalizedGatewaySessionViewOptions,
): GatewaySessionViewPart[] {
    if (part === null) {
        return []
    }

    const type = readString(part, "type")
    if (type === null) {
        return []
    }

    switch (type) {
        case "text":
            return isIgnoredTextPart(part) ? [] : renderBodyPart("text", "text", readString(part, "text"))
        case "reasoning":
            return options.includeReasoning ? renderBodyPart("reasoning", "reasoning", readString(part, "text")) : []
        case "tool":
            return options.includeTools ? renderToolViewPart(part, options) : []
        case "file":
            return options.includeFiles ? renderFileViewPart(part) : []
        case "subtask":
            return options.includeSubtasks ? renderSubtaskViewPart(part) : []
        case "snapshot":
            return options.includeSnapshots ? renderBodyPart("snapshot", "snapshot", readString(part, "snapshot")) : []
        case "patch":
            return options.includePatches ? renderPatchViewPart(part) : []
        case "step-start":
            return options.includeSteps ? renderStepStartViewPart(part) : []
        case "step-finish":
            return options.includeSteps ? renderStepFinishViewPart(part) : []
        case "compaction":
            return options.includeCompactions ? renderCompactionViewPart(part) : []
        case "retry":
            return options.includeRetries ? renderRetryViewPart(part) : []
        case "agent":
            return options.includeAgentParts ? renderAgentViewPart(part) : []
        default:
            return []
    }
}

function renderBodyPart(type: string, summary: string, body: string | null): GatewaySessionViewPart[] {
    return body === null
        ? []
        : [
              {
                  type,
                  summary,
                  body: truncateBody(body),
              },
          ]
}

function isIgnoredTextPart(part: UnknownRecord): boolean {
    return readBoolean(part, "ignored") === true
}

function renderToolViewPart(part: UnknownRecord, options: NormalizedGatewaySessionViewOptions): GatewaySessionViewPart[] {
    const state = asRecord(part.state)
    const toolName = readString(part, "tool") ?? "unknown"
    const status = readString(state, "status") ?? "unknown"
    const title = readString(state, "title")
    const attachments = readArray(state, "attachments")
        .map(asRecord)
        .filter((entry): entry is UnknownRecord => entry !== null)

    const sections: string[] = []
    if (options.includeToolInputs) {
        const inputText = readToolInputText(state)
        if (inputText !== null) {
            sections.push(["input:", inputText].join("\n"))
        }
    }

    if (options.includeToolOutputs) {
        const output = readString(state, "output")
        if (output !== null) {
            sections.push(["output:", output].join("\n"))
        }

        const error = readString(state, "error")
        if (error !== null) {
            sections.push(["error:", error].join("\n"))
        }
    }

    if (options.includeAttachments && attachments.length > 0) {
        sections.push(
            [
                "attachments:",
                ...attachments.map((attachment, index) => `  [${index + 1}] ${formatFileSummary(attachment)}`),
            ].join("\n"),
        )
    }

    return [
        {
            type: "tool",
            summary: summarizeToolPart(toolName, status, title, attachments.length),
            body: sections.length === 0 ? null : truncateBody(sections.join("\n\n")),
        },
    ]
}

function renderFileViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const sourceDetails = collectFileSourceDetails(part)

    return [
        {
            type: "file",
            summary: formatFileSummary(part),
            body: sourceDetails === null ? null : truncateBody(sourceDetails),
        },
    ]
}

function renderSubtaskViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const prompt = readString(part, "prompt")
    const description = readString(part, "description")
    const agent = readString(part, "agent")
    const sections = [
        prompt === null ? null : ["prompt:", prompt].join("\n"),
        description === null ? null : ["description:", description].join("\n"),
    ].filter((entry): entry is string => entry !== null)

    return [
        {
            type: "subtask",
            summary: agent === null ? "subtask" : `subtask agent=${agent}`,
            body: sections.length === 0 ? null : truncateBody(sections.join("\n\n")),
        },
    ]
}

function renderPatchViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const hash = readString(part, "hash")
    const files = readStringArray(part, "files")

    return [
        {
            type: "patch",
            summary: hash === null ? `patch files=${files.length}` : `patch hash=${hash} files=${files.length}`,
            body: files.length === 0 ? null : truncateBody(files.join("\n")),
        },
    ]
}

function renderStepStartViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const snapshot = readString(part, "snapshot")
    return [
        {
            type: "step-start",
            summary: "step-start",
            body: snapshot === null ? null : truncateBody(snapshot),
        },
    ]
}

function renderStepFinishViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const reason = readString(part, "reason")
    const snapshot = readString(part, "snapshot")
    const sections = [
        reason === null ? null : `reason=${reason}`,
        snapshot === null ? null : ["snapshot:", snapshot].join("\n"),
    ].filter((entry): entry is string => entry !== null)

    return [
        {
            type: "step-finish",
            summary: reason === null ? "step-finish" : `step-finish reason=${reason}`,
            body: sections.length === 0 ? null : truncateBody(sections.join("\n\n")),
        },
    ]
}

function renderCompactionViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const auto = readBoolean(part, "auto")

    return [
        {
            type: "compaction",
            summary: auto === null ? "compaction" : `compaction auto=${auto}`,
            body: null,
        },
    ]
}

function renderRetryViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const attempt = readNumber(part, "attempt")
    const error = extractRetryErrorMessage(part)

    return [
        {
            type: "retry",
            summary: attempt === null ? "retry" : `retry attempt=${attempt}`,
            body: error === null ? null : truncateBody(error),
        },
    ]
}

function renderAgentViewPart(part: UnknownRecord): GatewaySessionViewPart[] {
    const name = readString(part, "name")
    const source = readString(asRecord(part.source), "value")

    return [
        {
            type: "agent",
            summary: name === null ? "agent" : `agent name=${name}`,
            body: source === null ? null : truncateBody(source),
        },
    ]
}

function collectMessageSearchFields(message: OpencodeSessionMessageRecord): SearchField[] {
    return message.parts.flatMap((part) => collectPartSearchFields(asRecord(part)))
}

function collectPartSearchFields(part: UnknownRecord | null): SearchField[] {
    if (part === null) {
        return []
    }

    const type = readString(part, "type")
    if (type === null) {
        return []
    }

    switch (type) {
        case "text":
            return isIgnoredTextPart(part) ? [] : collectSingleStringField(type, "text", readString(part, "text"))
        case "reasoning":
            return collectSingleStringField(type, "text", readString(part, "text"))
        case "subtask":
            return [
                ...collectSingleStringField(type, "prompt", readString(part, "prompt")),
                ...collectSingleStringField(type, "description", readString(part, "description")),
                ...collectSingleStringField(type, "agent", readString(part, "agent")),
            ]
        case "file":
            return collectFileSearchFields(part, "file")
        case "tool":
            return collectToolSearchFields(part)
        case "snapshot":
            return collectSingleStringField(type, "snapshot", readString(part, "snapshot"))
        case "patch":
            return [
                ...collectSingleStringField(type, "hash", readString(part, "hash")),
                ...collectSingleStringField(type, "files", readStringArray(part, "files").join("\n")),
            ]
        case "step-start":
            return collectSingleStringField(type, "snapshot", readString(part, "snapshot"))
        case "step-finish":
            return [
                ...collectSingleStringField(type, "reason", readString(part, "reason")),
                ...collectSingleStringField(type, "snapshot", readString(part, "snapshot")),
            ]
        case "retry":
            return collectSingleStringField(type, "error", extractRetryErrorMessage(part))
        case "compaction":
            return collectSingleStringField(type, "auto", stringifyMaybeBoolean(readBoolean(part, "auto")))
        case "agent":
            return [
                ...collectSingleStringField(type, "name", readString(part, "name")),
                ...collectSingleStringField(type, "source", readString(asRecord(part.source), "value")),
            ]
        default:
            return []
    }
}

function collectToolSearchFields(part: UnknownRecord): SearchField[] {
    const state = asRecord(part.state)
    const attachments = readArray(state, "attachments")
        .map(asRecord)
        .filter((entry): entry is UnknownRecord => entry !== null)

    return [
        ...collectSingleStringField("tool", "tool", readString(part, "tool")),
        ...collectSingleStringField("tool", "status", readString(state, "status")),
        ...collectSingleStringField("tool", "title", readString(state, "title")),
        ...collectSingleStringField("tool", "input", readToolInputText(state)),
        ...collectSingleStringField("tool", "raw", readString(state, "raw")),
        ...collectSingleStringField("tool", "output", readString(state, "output")),
        ...collectSingleStringField("tool", "error", readString(state, "error")),
        ...attachments.flatMap((attachment) => collectFileSearchFields(attachment, "tool_attachment")),
    ]
}

function collectFileSearchFields(part: UnknownRecord, partType: string): SearchField[] {
    const source = asRecord(part.source)
    const sourceText = readString(asRecord(source?.text), "value")
    const sourcePath = readString(source, "path")

    return [
        ...collectSingleStringField(partType, "filename", readString(part, "filename")),
        ...collectSingleStringField(partType, "mime", readString(part, "mime")),
        ...collectSingleStringField(partType, "url", readString(part, "url")),
        ...collectSingleStringField(partType, "source_path", sourcePath),
        ...collectSingleStringField(partType, "source_text", sourceText),
    ]
}

function collectSingleStringField(partType: string, matchedField: string, text: string | null): SearchField[] {
    if (text === null) {
        return []
    }

    const normalized = text.trim()
    return normalized.length === 0
        ? []
        : [
              {
                  partType,
                  matchedField,
                  text: normalized,
              },
          ]
}

function compareSearchHits(left: GatewaySessionSearchHit, right: GatewaySessionSearchHit): number {
    return (right.matchedAtMs ?? 0) - (left.matchedAtMs ?? 0)
}

function createSnippet(text: string, matchIndex: number, queryLength: number): string {
    const start = Math.max(0, matchIndex - Math.floor((SEARCH_SNIPPET_LIMIT - queryLength) / 2))
    const end = Math.min(text.length, start + SEARCH_SNIPPET_LIMIT)
    const prefix = start > 0 ? "..." : ""
    const suffix = end < text.length ? "..." : ""
    return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function summarizeToolPart(toolName: string, status: string, title: string | null, attachmentCount: number): string {
    const segments = [`tool=${toolName}`, `status=${status}`]
    if (title !== null) {
        segments.push(`title=${title}`)
    }
    if (attachmentCount > 0) {
        segments.push(`attachments=${attachmentCount}`)
    }

    return segments.join(" ")
}

function formatFileSummary(part: UnknownRecord): string {
    const segments = ["file"]
    const mime = readString(part, "mime")
    const filename = readString(part, "filename")
    const url = readString(part, "url")

    if (mime !== null) {
        segments.push(`mime=${mime}`)
    }
    if (filename !== null) {
        segments.push(`filename=${filename}`)
    }
    if (url !== null) {
        segments.push(`url=${url}`)
    }

    return segments.join(" ")
}

function collectFileSourceDetails(part: UnknownRecord): string | null {
    const source = asRecord(part.source)
    if (source === null) {
        return null
    }

    const sections = [
        readString(source, "path") === null ? null : `source_path=${readString(source, "path")}`,
        readString(asRecord(source.text), "value") === null
            ? null
            : ["source_text:", readString(asRecord(source.text), "value") ?? ""].join("\n"),
    ].filter((entry): entry is string => entry !== null)

    return sections.length === 0 ? null : sections.join("\n\n")
}

function readToolInputText(state: UnknownRecord | null): string | null {
    if (state === null) {
        return null
    }

    const raw = readString(state, "raw")
    if (raw !== null) {
        return raw
    }

    const input = state.input
    if (input === undefined) {
        return null
    }

    return safeJsonStringify(input)
}

function extractRetryErrorMessage(part: UnknownRecord): string | null {
    return readString(asRecord(part.error), "message") ?? readString(asRecord(asRecord(part.error)?.data), "message")
}

function sortSessionMessages(messages: OpencodeSessionMessageRecord[]): OpencodeSessionMessageRecord[] {
    return [...messages].sort((left, right) => {
        const createdDelta = (left.createdAtMs ?? 0) - (right.createdAtMs ?? 0)
        if (createdDelta !== 0) {
            return createdDelta
        }

        return left.messageId.localeCompare(right.messageId)
    })
}

function collectVisibleParts(options: NormalizedGatewaySessionViewOptions): string[] {
    const parts = ["text"]
    if (options.includeReasoning) {
        parts.push("reasoning")
    }
    if (options.includeTools) {
        parts.push("tools")
    }
    if (options.includeToolInputs) {
        parts.push("tool_inputs")
    }
    if (options.includeToolOutputs) {
        parts.push("tool_outputs")
    }
    if (options.includeFiles) {
        parts.push("files")
    }
    if (options.includeAttachments) {
        parts.push("attachments")
    }
    if (options.includeSubtasks) {
        parts.push("subtasks")
    }
    if (options.includeSnapshots) {
        parts.push("snapshots")
    }
    if (options.includePatches) {
        parts.push("patches")
    }
    if (options.includeSteps) {
        parts.push("steps")
    }
    if (options.includeCompactions) {
        parts.push("compactions")
    }
    if (options.includeRetries) {
        parts.push("retries")
    }
    if (options.includeAgentParts) {
        parts.push("agent_parts")
    }

    return parts
}

function normalizeRequiredQuery(query: string): string {
    const normalized = query.trim()
    if (normalized.length === 0) {
        throw new Error("query must not be empty")
    }

    return normalized
}

function normalizeOptionalSessionId(sessionId: string | null | undefined): string | null {
    if (sessionId === undefined || sessionId === null) {
        return null
    }

    return normalizeRequiredSessionId(sessionId)
}

function normalizeRequiredSessionId(sessionId: string | null | undefined): string {
    if (typeof sessionId !== "string") {
        throw new Error("session_id is required")
    }

    const normalized = sessionId.trim()
    if (normalized.length === 0) {
        throw new Error("session_id must not be empty")
    }

    return normalized
}

function normalizePositiveInteger(
    value: number | null | undefined,
    fallback: number,
    max: number,
    field: string,
): number {
    if (value === undefined || value === null) {
        return fallback
    }

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${field} must be a positive integer`)
    }

    return Math.min(value, max)
}

function normalizeNonNegativeInteger(
    value: number | null | undefined,
    fallback: number,
    field: string,
): number {
    if (value === undefined || value === null) {
        return fallback
    }

    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative integer`)
    }

    return value
}

function normalizeViewOptions(options: GatewaySessionViewOptions): NormalizedGatewaySessionViewOptions {
    return {
        offset: normalizeNonNegativeInteger(options.offset, DEFAULT_VIEW_OFFSET, "offset"),
        messageLimit: normalizePositiveInteger(
            options.messageLimit,
            DEFAULT_VIEW_MESSAGE_LIMIT,
            MAX_VIEW_MESSAGE_LIMIT,
            "message_limit",
        ),
        includeReasoning: options.includeReasoning ?? false,
        includeAttachments: options.includeAttachments ?? false,
        includeTools: options.includeTools ?? true,
        includeToolInputs: options.includeToolInputs ?? false,
        includeToolOutputs: options.includeToolOutputs ?? true,
        includeFiles: options.includeFiles ?? false,
        includeSubtasks: options.includeSubtasks ?? false,
        includeSnapshots: options.includeSnapshots ?? false,
        includePatches: options.includePatches ?? false,
        includeSteps: options.includeSteps ?? false,
        includeCompactions: options.includeCompactions ?? false,
        includeRetries: options.includeRetries ?? false,
        includeAgentParts: options.includeAgentParts ?? false,
    }
}

function truncateBody(text: string): string {
    if (text.length <= VIEW_BODY_LIMIT) {
        return text
    }

    return `${text.slice(0, VIEW_BODY_LIMIT)}\n[truncated after ${VIEW_BODY_LIMIT} chars]`
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)]
}

function asRecord(value: unknown): UnknownRecord | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null
    }

    return value as UnknownRecord
}

function readString(value: UnknownRecord | null | undefined, field: string): string | null {
    if (value === null || value === undefined) {
        return null
    }

    const raw = value[field]
    return typeof raw === "string" && raw.length > 0 ? raw : null
}

function readNumber(value: UnknownRecord | null | undefined, field: string): number | null {
    if (value === null || value === undefined) {
        return null
    }

    const raw = value[field]
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

function readBoolean(value: UnknownRecord | null | undefined, field: string): boolean | null {
    if (value === null || value === undefined) {
        return null
    }

    const raw = value[field]
    return typeof raw === "boolean" ? raw : null
}

function readArray(value: UnknownRecord | null | undefined, field: string): unknown[] {
    if (value === null || value === undefined) {
        return []
    }

    const raw = value[field]
    return Array.isArray(raw) ? raw : []
}

function readStringArray(value: UnknownRecord | null | undefined, field: string): string[] {
    return readArray(value, field).filter((entry): entry is string => typeof entry === "string")
}

function stringifyMaybeBoolean(value: boolean | null): string | null {
    return value === null ? null : String(value)
}

function safeJsonStringify(value: unknown): string | null {
    try {
        return JSON.stringify(value)
    } catch {
        return null
    }
}
