import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadGatewayConfig } from "./gateway"

test("loadGatewayConfig resolves relative state_db against the config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, '[gateway]\nstate_db = "state/custom.db"\n')

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.configPath).toBe(configPath)
        expect(config.stateDbPath).toBe(join(root, "state", "custom.db"))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig falls back to the XDG default state path when no config file exists", async () => {
    const configRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-xdg-config-"))
    const dataRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-xdg-data-"))

    try {
        const config = await loadGatewayConfig({
            XDG_CONFIG_HOME: configRoot,
            XDG_DATA_HOME: dataRoot,
        })

        expect(config.configPath).toBe(join(configRoot, "opencode-gateway", "config.toml"))
        expect(config.stateDbPath).toBe(join(dataRoot, "opencode-gateway", "state.db"))
    } finally {
        await rm(configRoot, { recursive: true, force: true })
        await rm(dataRoot, { recursive: true, force: true })
    }
})
