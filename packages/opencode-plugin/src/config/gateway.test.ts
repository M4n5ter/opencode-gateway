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

test("loadGatewayConfig requires an explicit telegram allowlist when Telegram is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            ["[channels.telegram]", "enabled = true", 'bot_token_env = "TELEGRAM_BOT_TOKEN"'].join("\n"),
        )

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
                TELEGRAM_BOT_TOKEN: "secret",
            }),
        ).rejects.toThrow("no allowlist entries")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig normalizes Telegram allowlist identifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[channels.telegram]",
                "enabled = true",
                'bot_token_env = "TELEGRAM_BOT_TOKEN"',
                'allowed_chats = [-100123456, "-100999888"]',
                'allowed_users = [42, "77"]',
            ].join("\n"),
        )

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
            TELEGRAM_BOT_TOKEN: "secret",
        })

        expect(config.telegram).toEqual({
            enabled: true,
            botToken: "secret",
            botTokenEnv: "TELEGRAM_BOT_TOKEN",
            pollTimeoutSeconds: 25,
            allowedChats: ["-100123456", "-100999888"],
            allowedUsers: ["42", "77"],
        })
        expect(config.cron).toEqual({
            enabled: true,
            tickSeconds: 5,
            maxConcurrentRuns: 1,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig validates cron scheduler settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            ["[cron]", "enabled = true", "tick_seconds = 0", "max_concurrent_runs = 0"].join("\n"),
        )

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
            }),
        ).rejects.toThrow("cron.tick_seconds must be greater than or equal to 1")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
