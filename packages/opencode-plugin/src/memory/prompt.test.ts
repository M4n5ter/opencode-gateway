import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayMemoryConfig } from "../config/memory"
import { GatewayMemoryPromptProvider } from "./prompt"

test("GatewayMemoryPromptProvider expands recursive markdown and explicit globbed text files", async () => {
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
                    injectMarkdownContents: true,
                    globs: ["**/*.txt", "**/*.bin"],
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
        expect(prompt).toContain("File: memory/docs/notes.markdown")
        expect(prompt).toContain("File: memory/docs/project.md")
        expect(prompt).toContain("File: memory/extra/info.txt")
        expect(prompt).not.toContain("File: memory/extra/blob.bin")
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("memory file looks binary")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
