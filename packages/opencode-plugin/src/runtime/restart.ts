import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { GATEWAY_RESTART_REQUEST_FILE, GATEWAY_RESTART_STATUS_FILE, resolveGatewayControlDir } from "../config/paths"

export type GatewayRestartState = "unmanaged" | "idle" | "pending" | "restarting" | "failed"

type RestartRequestDocument = {
    requestedAtMs: number
    requestedBy: string
}

type RestartStatusDocument = {
    state: Exclude<GatewayRestartState, "unmanaged">
    requestedAtMs?: number
    startedAtMs?: number
    completedAtMs?: number
    lastError?: string
}

export type GatewayRestartStatus = {
    managed: boolean
    supported: boolean
    state: GatewayRestartState
    pending: boolean
    requestedAtMs: number | null
    startedAtMs: number | null
    completedAtMs: number | null
    lastError: string | null
}

export type GatewayRestartRequestResult = {
    status: "scheduled" | "already_scheduled"
    behavior: "wait_until_idle"
    scope: "managed_opencode_server"
    effectiveOn: "after_current_request_and_when_idle"
    requestedAtMs: number
}

export class GatewayRestartRuntime {
    private deferredRequestedAtMs: number | null = null

    private constructor(
        private readonly managed: boolean,
        private readonly controlDirPath: string | null,
    ) {}

    static fromEnvironment(env: Record<string, string | undefined>): GatewayRestartRuntime {
        const managed = env.OPENCODE_GATEWAY_MANAGED === "1"
        const controlDirPath = managed ? resolveGatewayControlDir(env) : null
        return new GatewayRestartRuntime(managed, controlDirPath)
    }

    async scheduleRestart(): Promise<GatewayRestartRequestResult> {
        const controlDirPath = this.ensureManaged()

        await mkdir(controlDirPath, { recursive: true })

        const existingRequest = await readJson<RestartRequestDocument>(requestPath(controlDirPath))
        const now = Date.now()
        const requestedAtMs = existingRequest?.requestedAtMs ?? this.deferredRequestedAtMs ?? now
        const alreadyScheduled = existingRequest !== null || this.deferredRequestedAtMs !== null

        if (!alreadyScheduled) {
            this.deferredRequestedAtMs = requestedAtMs
        }

        const previousStatus = await readJson<RestartStatusDocument>(statusPath(controlDirPath))
        await writeJson(statusPath(controlDirPath), {
            state: "pending",
            requestedAtMs,
            completedAtMs: previousStatus?.completedAtMs,
            lastError: previousStatus?.lastError,
        } satisfies RestartStatusDocument)

        return {
            status: alreadyScheduled ? "already_scheduled" : "scheduled",
            behavior: "wait_until_idle",
            scope: "managed_opencode_server",
            effectiveOn: "after_current_request_and_when_idle",
            requestedAtMs,
        }
    }

    async flushPendingRestartRequest(): Promise<void> {
        const controlDirPath = this.ensureManaged()
        if (this.deferredRequestedAtMs === null) {
            return
        }

        await mkdir(controlDirPath, { recursive: true })

        const existingRequest = await readJson<RestartRequestDocument>(requestPath(controlDirPath))
        const requestedAtMs = existingRequest?.requestedAtMs ?? this.deferredRequestedAtMs
        if (existingRequest === null) {
            await writeJson(requestPath(controlDirPath), {
                requestedAtMs,
                requestedBy: "gateway_restart",
            } satisfies RestartRequestDocument)
        }

        const previousStatus = await readJson<RestartStatusDocument>(statusPath(controlDirPath))
        await writeJson(statusPath(controlDirPath), {
            state: "pending",
            requestedAtMs,
            completedAtMs: previousStatus?.completedAtMs,
            lastError: previousStatus?.lastError,
        } satisfies RestartStatusDocument)

        this.deferredRequestedAtMs = null
    }

    async status(): Promise<GatewayRestartStatus> {
        if (!this.managed || this.controlDirPath === null) {
            return {
                managed: false,
                supported: false,
                state: "unmanaged",
                pending: false,
                requestedAtMs: null,
                startedAtMs: null,
                completedAtMs: null,
                lastError: null,
            }
        }

        const [request, status] = await Promise.all([
            readJson<RestartRequestDocument>(requestPath(this.controlDirPath)),
            readJson<RestartStatusDocument>(statusPath(this.controlDirPath)),
        ])

        const pending = request !== null || this.deferredRequestedAtMs !== null
        const state = pending ? (status?.state ?? "pending") : (status?.state ?? "idle")

        return {
            managed: true,
            supported: true,
            state,
            pending,
            requestedAtMs: request?.requestedAtMs ?? this.deferredRequestedAtMs ?? status?.requestedAtMs ?? null,
            startedAtMs: status?.startedAtMs ?? null,
            completedAtMs: status?.completedAtMs ?? null,
            lastError: status?.lastError ?? null,
        }
    }

    private ensureManaged(): string {
        if (!this.managed || this.controlDirPath === null) {
            throw new Error(
                "gateway_restart is only available when OpenCode is started by opencode-gateway serve; manual opencode serve sessions must be restarted manually",
            )
        }

        return this.controlDirPath
    }
}

function requestPath(controlDirPath: string): string {
    return join(controlDirPath, GATEWAY_RESTART_REQUEST_FILE)
}

function statusPath(controlDirPath: string): string {
    return join(controlDirPath, GATEWAY_RESTART_STATUS_FILE)
}

async function readJson<T>(path: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(path, "utf8")) as T
    } catch (error) {
        if (isMissingFileError(error)) {
            return null
        }

        throw error
    }
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "ENOENT"
}
