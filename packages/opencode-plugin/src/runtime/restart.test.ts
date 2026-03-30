import { expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GATEWAY_RESTART_REQUEST_FILE, GATEWAY_RESTART_STATUS_FILE } from "../config/paths"
import { GatewayRestartRuntime } from "./restart"

test("GatewayRestartRuntime schedules a managed restart request and reports pending status", async () => {
    const controlDir = await mkdtemp(join(tmpdir(), "gateway-restart-"))
    const runtime = GatewayRestartRuntime.fromEnvironment({
        OPENCODE_GATEWAY_MANAGED: "1",
        OPENCODE_GATEWAY_CONTROL_DIR: controlDir,
    })

    const result = await runtime.scheduleRestart()
    const status = await runtime.status()

    expect(result.status).toBe("scheduled")
    expect(status.managed).toBe(true)
    expect(status.pending).toBe(true)
    expect(status.state).toBe("pending")

    const request = JSON.parse(await readFile(join(controlDir, GATEWAY_RESTART_REQUEST_FILE), "utf8")) as {
        requestedAtMs: number
    }
    const persistedStatus = JSON.parse(await readFile(join(controlDir, GATEWAY_RESTART_STATUS_FILE), "utf8")) as {
        state: string
    }

    expect(request.requestedAtMs).toBe(result.requestedAtMs)
    expect(persistedStatus.state).toBe("pending")
})

test("GatewayRestartRuntime deduplicates duplicate managed restart requests", async () => {
    const controlDir = await mkdtemp(join(tmpdir(), "gateway-restart-"))
    const runtime = GatewayRestartRuntime.fromEnvironment({
        OPENCODE_GATEWAY_MANAGED: "1",
        OPENCODE_GATEWAY_CONTROL_DIR: controlDir,
    })

    const first = await runtime.scheduleRestart()
    const second = await runtime.scheduleRestart()

    expect(first.status).toBe("scheduled")
    expect(second.status).toBe("already_scheduled")
    expect(second.requestedAtMs).toBe(first.requestedAtMs)
})

test("GatewayRestartRuntime rejects restart requests outside managed mode", async () => {
    const runtime = GatewayRestartRuntime.fromEnvironment({})

    await expect(runtime.scheduleRestart()).rejects.toThrow("gateway_restart is only available")
    await expect(runtime.status()).resolves.toMatchObject({
        managed: false,
        supported: false,
        state: "unmanaged",
    })
})
