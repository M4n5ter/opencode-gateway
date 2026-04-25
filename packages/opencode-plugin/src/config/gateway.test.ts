import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
        expect(config.workspaceDirPath).toBe(join(root, "opencode-gateway-workspace"))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig resolves memory paths against the gateway workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "opencode-gateway.toml")
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const memoryFilePath = join(workspaceDirPath, "memory", "project.md")

    try {
        await mkdir(join(workspaceDirPath, "memory"), { recursive: true })
        await writeFile(
            configPath,
            [
                "[[memory.entries]]",
                'path = "memory/project.md"',
                'description = "Project conventions"',
                "inject_content = true",
            ].join("\n"),
        )
        await writeFile(memoryFilePath, "# Project")

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.memory.entries).toEqual([
            {
                kind: "file",
                path: memoryFilePath,
                displayPath: "memory/project.md",
                description: "Project conventions",
                header: null,
                footer: null,
                injectContent: true,
                searchOnly: false,
            },
        ])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig prefers OPENCODE_CONFIG_DIR/opencode-gateway.toml when no explicit path is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-dir-"))
    const configDir = join(root, "opencode")
    const configPath = join(configDir, "opencode-gateway.toml")

    try {
        await mkdir(configDir, { recursive: true })
        await writeFile(configPath, '[gateway]\nstate_db = "state/custom.db"\n')

        const config = await loadGatewayConfig({
            OPENCODE_CONFIG_DIR: configDir,
        })

        expect(config.configPath).toBe(configPath)
        expect(config.stateDbPath).toBe(join(configDir, "state", "custom.db"))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig falls back to the global opencode config directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-global-"))
    const configHome = join(root, "config-home")
    const configDir = join(configHome, "opencode")
    const configPath = join(configDir, "opencode-gateway.toml")

    try {
        await mkdir(configDir, { recursive: true })
        await writeFile(configPath, "")

        const config = await loadGatewayConfig({
            XDG_CONFIG_HOME: configHome,
        })

        expect(config.configPath).toBe(configPath)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig defaults mailbox batching to off", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, "")

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.logLevel).toBe("off")
        expect(config.mailbox).toEqual({
            batchReplies: false,
            batchWindowMs: 1_500,
            routes: [],
        })
        expect(config.inflightMessages).toEqual({
            defaultPolicy: "ask",
        })
        expect(config.httpProxy).toEqual({
            enabled: true,
        })
        expect(config.execution).toEqual({
            sessionWaitTimeoutMs: 30 * 60_000,
            promptProgressTimeoutMs: 30 * 60_000,
            hardTimeoutMs: null,
            abortSettleTimeoutMs: 5_000,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses HTTP proxy settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway.http_proxy]", "enabled = false"].join("\n"))

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.httpProxy).toEqual({
            enabled: false,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig rejects invalid HTTP proxy settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway.http_proxy]", 'enabled = "yes"'].join("\n"))

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
            }),
        ).rejects.toThrow("gateway.http_proxy.enabled must be a boolean when present")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses inflight message policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway.inflight_messages]", 'default_policy = "interrupt"'].join("\n"))

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.inflightMessages).toEqual({
            defaultPolicy: "interrupt",
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses gateway.log_level", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway]", 'log_level = "warn"'].join("\n"))

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.logLevel).toBe("warn")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses mailbox batching settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway.mailbox]", "batch_replies = true", "batch_window_ms = 2500"].join("\n"))

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.mailbox).toEqual({
            batchReplies: true,
            batchWindowMs: 2_500,
            routes: [],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses execution timeout settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[gateway.execution]",
                "session_wait_timeout_ms = 120000",
                "prompt_progress_timeout_ms = 300000",
                "hard_timeout_ms = 7200000",
                "abort_settle_timeout_ms = 15000",
            ].join("\n"),
        )

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.execution).toEqual({
            sessionWaitTimeoutMs: 120_000,
            promptProgressTimeoutMs: 300_000,
            hardTimeoutMs: 7_200_000,
            abortSettleTimeoutMs: 15_000,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig rejects a too-small hard timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(configPath, ["[gateway.execution]", "hard_timeout_ms = 5000"].join("\n"))

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
            }),
        ).rejects.toThrow("gateway.execution.hard_timeout_ms must be at least 60000")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses explicit mailbox routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[gateway.mailbox]",
                "batch_replies = false",
                "",
                "[[gateway.mailbox.routes]]",
                'channel = "telegram"',
                'target = "42"',
                'mailbox_key = "shared:alpha"',
                "",
                "[[gateway.mailbox.routes]]",
                'channel = "telegram"',
                'target = "-100123"',
                'topic = "99"',
                'mailbox_key = "shared:alpha"',
            ].join("\n"),
        )

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.mailbox).toEqual({
            batchReplies: false,
            batchWindowMs: 1_500,
            routes: [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                    mailboxKey: "shared:alpha",
                },
                {
                    channel: "telegram",
                    target: "-100123",
                    topic: "99",
                    mailboxKey: "shared:alpha",
                },
            ],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig rejects duplicate mailbox route matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[[gateway.mailbox.routes]]",
                'channel = "telegram"',
                'target = "42"',
                'mailbox_key = "shared:alpha"',
                "",
                "[[gateway.mailbox.routes]]",
                'channel = "telegram"',
                'target = "42"',
                'mailbox_key = "shared:beta"',
            ].join("\n"),
        )

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
            }),
        ).rejects.toThrow("duplicate match")
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

test("loadGatewayConfig accepts a direct Telegram bot token from config", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            ["[channels.telegram]", "enabled = true", 'bot_token = "direct-secret"', "allowed_users = [42]"].join("\n"),
        )

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.telegram).toEqual({
            enabled: true,
            botToken: "direct-secret",
            botTokenEnv: null,
            pollTimeoutSeconds: 25,
            allowedChats: [],
            allowedUsers: ["42"],
            ux: {
                toolCallView: "toggle",
                compactionReaction: true,
                compactionReactionEmoji: "🗜️",
            },
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig enables Telegram tool-call UX by default and parses explicit overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[channels.telegram]",
                "enabled = true",
                'bot_token = "123456:ABCDEF"',
                "allowed_users = [42]",
                "",
                "[channels.telegram.ux]",
                'tool_call_view = "off"',
                "compaction_reaction = false",
                'compaction_reaction_emoji = "🧠"',
            ].join("\n"),
        )

        const overridden = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })
        expect(overridden.telegram.enabled).toBe(true)
        if (overridden.telegram.enabled) {
            expect(overridden.telegram.ux.toolCallView).toBe("off")
            expect(overridden.telegram.ux.compactionReaction).toBe(false)
            expect(overridden.telegram.ux.compactionReactionEmoji).toBe("🧠")
        }

        await writeFile(
            configPath,
            ["[channels.telegram]", "enabled = true", 'bot_token = "123456:ABCDEF"', "allowed_users = [42]"].join("\n"),
        )
        const defaulted = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })
        expect(defaulted.telegram.enabled).toBe(true)
        if (defaulted.telegram.enabled) {
            expect(defaulted.telegram.ux.toolCallView).toBe("toggle")
            expect(defaulted.telegram.ux.compactionReaction).toBe(true)
            expect(defaulted.telegram.ux.compactionReactionEmoji).toBe("🗜️")
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig rejects configuring both bot_token and bot_token_env", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            [
                "[channels.telegram]",
                "enabled = true",
                'bot_token = "direct-secret"',
                'bot_token_env = "TELEGRAM_BOT_TOKEN"',
                "allowed_users = [42]",
            ].join("\n"),
        )

        await expect(
            loadGatewayConfig({
                OPENCODE_GATEWAY_CONFIG: configPath,
            }),
        ).rejects.toThrow("mutually exclusive")
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
            ux: {
                toolCallView: "toggle",
                compactionReaction: true,
                compactionReactionEmoji: "🗜️",
            },
        })
        expect(config.mailbox).toEqual({
            batchReplies: false,
            batchWindowMs: 1_500,
            routes: [],
        })
        expect(config.hasLegacyGatewayTimezone).toBe(false)
        expect(config.legacyGatewayTimezone).toBeNull()
        expect(config.cron).toEqual({
            enabled: true,
            tickSeconds: 5,
            maxConcurrentRuns: 1,
            timezone: null,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("loadGatewayConfig parses cron timezone and preserves legacy gateway timezone for warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-config-"))
    const configPath = join(root, "config.toml")

    try {
        await writeFile(
            configPath,
            ["[gateway]", 'timezone = "UTC"', "", "[cron]", 'timezone = "Asia/Shanghai"'].join("\n"),
        )

        const config = await loadGatewayConfig({
            OPENCODE_GATEWAY_CONFIG: configPath,
        })

        expect(config.hasLegacyGatewayTimezone).toBe(true)
        expect(config.legacyGatewayTimezone).toBe("UTC")
        expect(config.cron.timezone).toBe("Asia/Shanghai")
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
