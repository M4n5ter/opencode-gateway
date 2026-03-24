import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayMemoryConfig } from "../config/memory"
import { GatewayMemoryPromptProvider } from "../memory/prompt"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewaySessionContext } from "./context"
import { GatewaySystemPromptBuilder } from "./system-prompt"

test("GatewaySystemPromptBuilder combines gateway target context with memory content", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-system-prompt-"))
    const db = new Database(":memory:")
    const memoryFile = join(root, "memory", "project.md")

    try {
        migrateGatewayDatabase(db)
        await mkdir(join(root, "memory"), { recursive: true })
        await writeFile(memoryFile, "# Project")

        const store = new SqliteStore(db)
        const sessions = new GatewaySessionContext(store)
        sessions.replaceReplyTargets(
            "ses_gateway",
            "telegram:42",
            [
                {
                    channel: "telegram",
                    target: "42",
                    topic: null,
                },
            ],
            1,
        )

        const prompts = await createBuilder(sessions, {
            entries: [
                {
                    kind: "file",
                    path: memoryFile,
                    displayPath: "memory/project.md",
                    description: "Project conventions",
                    injectContent: true,
                },
            ],
        }).buildPrompts("ses_gateway")

        expect(prompts).toHaveLength(2)
        expect(prompts[0]).toContain("Current message source channel: telegram")
        expect(prompts[0]).toContain("Current reply target id: 42")
        expect(prompts[1]).toContain("Gateway memory:")
        expect(prompts[1]).toContain("Configured path: memory/project.md")
        expect(prompts[1]).toContain("File: memory/project.md")
        expect(prompts[1]).toContain("# Project")
    } finally {
        db.close()
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewaySystemPromptBuilder injects memory for gateway-owned schedule sessions without reply targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-system-prompt-"))
    const db = new Database(":memory:")
    const memoryFile = join(root, "memory", "project.md")

    try {
        migrateGatewayDatabase(db)
        await mkdir(join(root, "memory"), { recursive: true })
        await writeFile(memoryFile, "# Project")

        const store = new SqliteStore(db)
        store.putSessionBinding("cron:daily", "ses_schedule", 1)
        const prompts = await createBuilder(new GatewaySessionContext(store), {
            entries: [
                {
                    kind: "file",
                    path: memoryFile,
                    displayPath: "memory/project.md",
                    description: "Project conventions",
                    injectContent: false,
                },
            ],
        }).buildPrompts("ses_schedule")

        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain("Gateway memory:")
        expect(prompts[0]).toContain("Configured path: memory/project.md")
        expect(prompts[0]).not.toContain("Gateway context:")
    } finally {
        db.close()
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewaySystemPromptBuilder skips unrelated sessions", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)

        const prompts = await createBuilder(new GatewaySessionContext(store), {
            entries: [],
        }).buildPrompts("ses_plain")

        expect(prompts).toEqual([])
    } finally {
        db.close()
    }
})

function createBuilder(sessions: GatewaySessionContext, memory: GatewayMemoryConfig): GatewaySystemPromptBuilder {
    return new GatewaySystemPromptBuilder(
        sessions,
        new GatewayMemoryPromptProvider(memory, {
            log() {},
        }),
    )
}
