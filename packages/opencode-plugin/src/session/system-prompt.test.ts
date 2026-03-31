import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayMemoryConfig } from "../config/memory"
import { GatewayMemoryPromptProvider } from "../memory/prompt"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { createMemoryDatabase } from "../test/sqlite"
import { GatewaySessionContext } from "./context"
import { GatewaySystemPromptBuilder } from "./system-prompt"

test("GatewaySystemPromptBuilder combines gateway target context with memory content", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-system-prompt-"))
    const db = createMemoryDatabase()
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
                    searchOnly: false,
                },
            ],
        }).buildPrompts("ses_gateway")

        expect(prompts).toHaveLength(3)
        expect(prompts[0]).toContain("Current message source channel: telegram")
        expect(prompts[0]).toContain("Current reply target id: 42")
        expect(prompts[0]).toContain("can request that restart for them")
        expect(prompts[1]).toContain("Gateway skills:")
        expect(prompts[1]).toContain("workspace-local skills directory at `.opencode/skills`")
        expect(prompts[1]).toContain("After completing a complex task")
        expect(prompts[1]).toContain("do not stop at telling them to restart manually")
        expect(prompts[2]).toContain("Gateway memory:")
        expect(prompts[2]).toContain("Configured path: memory/project.md")
        expect(prompts[2]).toContain("File: memory/project.md")
        expect(prompts[2]).toContain("# Project")
    } finally {
        db.close()
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewaySystemPromptBuilder injects memory for gateway-owned schedule sessions without reply targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-system-prompt-"))
    const db = createMemoryDatabase()
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
                    searchOnly: false,
                },
            ],
        }).buildPrompts("ses_schedule")

        expect(prompts).toHaveLength(2)
        expect(prompts[0]).toContain("Gateway skills:")
        expect(prompts[0]).toContain("tell them you can request the restart for them")
        expect(prompts[1]).toContain("Gateway memory:")
        expect(prompts[1]).toContain("Configured path: memory/project.md")
        expect(prompts[1]).not.toContain("Gateway context:")
    } finally {
        db.close()
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewaySystemPromptBuilder skips unrelated sessions", async () => {
    const db = createMemoryDatabase()

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

test("GatewaySystemPromptBuilder still injects skills guidance when a gateway session has no configured memory", async () => {
    const db = createMemoryDatabase()

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        store.putSessionBinding("cron:daily", "ses_schedule", 1)

        const prompts = await createBuilder(new GatewaySessionContext(store), {
            entries: [],
        }).buildPrompts("ses_schedule")

        expect(prompts).toEqual([expect.stringContaining("Gateway skills:")])
        expect(prompts[0]).toContain("gateway_restart")
        expect(prompts[0]).toContain("proactively distill the reusable high-signal workflow")
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
