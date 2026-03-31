import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayMemoryConfig } from "../config/memory"
import { GatewayMemoryPromptProvider } from "./prompt"

test("GatewayMemoryPromptProvider auto-injects only glob-matched directory files", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-prompt-"))
    const memoryDir = join(root, "memory")
    const warnings: string[] = []

    try {
        await mkdir(join(memoryDir, "docs"), { recursive: true })
        await mkdir(join(memoryDir, "extra"), { recursive: true })
        await writeFile(join(memoryDir, "docs", "project.md"), "# Project")
        await writeFile(join(memoryDir, "docs", "notes.markdown"), "Notes")
        await writeFile(join(memoryDir, "extra", "info.txt"), "Extra")
        await writeFile(join(memoryDir, "extra", "blob.bin"), new Uint8Array([0x00, 0x01, 0x02]))

        const config: GatewayMemoryConfig = {
            entries: [
                {
                    kind: "directory",
                    path: memoryDir,
                    displayPath: "memory",
                    description: "Long-lived notes",
                    globs: ["**/*.md", "**/*.txt", "**/*.bin"],
                    searchOnly: false,
                },
            ],
        }
        const prompt = await new GatewayMemoryPromptProvider(config, {
            log(level, message) {
                if (level === "warn") {
                    warnings.push(message)
                }
            },
        }).buildPrompt()

        expect(prompt).not.toBeNull()
        expect(prompt).toContain("Gateway memory:")
        expect(prompt).toContain("Configured path: memory")
        expect(prompt).toContain("Access: globs are auto-injected")
        expect(prompt).toContain("Auto-injected globs: **/*.md, **/*.txt, **/*.bin")
        expect(prompt).toContain("File: memory/docs/project.md")
        expect(prompt).toContain("File: memory/extra/info.txt")
        expect(prompt).not.toContain("File: memory/docs/notes.markdown")
        expect(prompt).not.toContain("File: memory/extra/blob.bin")
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("memory file looks binary")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryPromptProvider marks search-only entries without injecting their content", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-prompt-"))
    const memoryFile = join(root, "USER.md")

    try {
        await writeFile(memoryFile, "# User")

        const config: GatewayMemoryConfig = {
            entries: [
                {
                    kind: "file",
                    path: memoryFile,
                    displayPath: "USER.md",
                    description: "User profile",
                    injectContent: false,
                    searchOnly: true,
                },
            ],
        }

        const prompt = await new GatewayMemoryPromptProvider(config, { log() {} }).buildPrompt()

        expect(prompt).not.toBeNull()
        expect(prompt).toContain("Configured path: USER.md")
        expect(prompt).toContain("Access: search-only")
        expect(prompt).not.toContain("File: USER.md")
        expect(prompt).not.toContain("# User")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryPromptProvider only injects maintenance policy for configured default memory entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-prompt-"))

    try {
        const prompt = await new GatewayMemoryPromptProvider(
            {
                entries: [
                    {
                        kind: "file",
                        path: join(root, "USER.md"),
                        displayPath: "USER.md",
                        description: "User profile",
                        injectContent: false,
                        searchOnly: true,
                    },
                    {
                        kind: "directory",
                        path: join(root, "memory", "daily"),
                        displayPath: "memory/daily",
                        description: "Daily notes",
                        globs: [],
                        searchOnly: true,
                    },
                ],
            },
            { log() {} },
        ).buildPrompt()

        expect(prompt).not.toBeNull()
        expect(prompt).toContain("Memory maintenance policy:")
        expect(prompt).toContain("Update `USER.md` proactively")
        expect(prompt).toContain("Update `memory/daily/YYYY-MM-DD.md` proactively")
        expect(prompt).not.toContain("Update `RULES.md` proactively")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryPromptProvider skips default maintenance policy when no default memory entries are configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-prompt-"))
    const memoryFile = join(root, "memory", "project.md")

    try {
        await mkdir(join(root, "memory"), { recursive: true })
        await writeFile(memoryFile, "# Project")

        const prompt = await new GatewayMemoryPromptProvider(
            {
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
            },
            { log() {} },
        ).buildPrompt()

        expect(prompt).not.toBeNull()
        expect(prompt).not.toContain("Memory maintenance policy:")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryPromptProvider wraps a memory block with configured header and footer", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-prompt-"))
    const memoryFile = join(root, "USER.md")

    try {
        await writeFile(memoryFile, "# User")

        const prompt = await new GatewayMemoryPromptProvider(
            {
                entries: [
                    {
                        kind: "file",
                        path: memoryFile,
                        displayPath: "USER.md",
                        description: "User profile",
                        header: "<important>",
                        footer: "</important>",
                        injectContent: true,
                        searchOnly: false,
                    },
                ],
            },
            { log() {} },
        ).buildPrompt()

        expect(prompt).not.toBeNull()
        expect(prompt).toContain("<important>\nConfigured path: USER.md")
        expect(prompt).toContain("</important>")
        expect(prompt).toContain("File: USER.md")

        const text = prompt ?? ""
        expect(text.indexOf("<important>")).toBeLessThan(text.indexOf("Configured path: USER.md"))
        expect(text.indexOf("</important>")).toBeGreaterThan(text.indexOf("File: USER.md"))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
