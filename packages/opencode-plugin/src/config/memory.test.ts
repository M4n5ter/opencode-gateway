import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseMemoryConfig } from "./memory"

test("parseMemoryConfig resolves relative file entries against the config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const configPath = join(root, "opencode-gateway.toml")
    const filePath = join(root, "memory", "project.md")

    try {
        await mkdir(join(root, "memory"), { recursive: true })
        await writeFile(filePath, "# Project")

        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "memory/project.md",
                        description: "Project conventions",
                        inject_content: true,
                    },
                ],
            },
            configPath,
        )

        expect(config).toEqual({
            entries: [
                {
                    kind: "file",
                    path: filePath,
                    displayPath: "memory/project.md",
                    description: "Project conventions",
                    injectContent: true,
                },
            ],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig parses directory entries and keeps glob patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const configPath = join(root, "opencode-gateway.toml")
    const directoryPath = join(root, "notes")

    try {
        await mkdir(directoryPath, { recursive: true })

        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "notes",
                        description: "Long-lived notes",
                        inject_markdown_contents: true,
                        globs: ["**/*.txt", "ops/**/*.yaml"],
                    },
                ],
            },
            configPath,
        )

        expect(config).toEqual({
            entries: [
                {
                    kind: "directory",
                    path: directoryPath,
                    displayPath: "notes",
                    description: "Long-lived notes",
                    injectMarkdownContents: true,
                    globs: ["**/*.txt", "ops/**/*.yaml"],
                },
            ],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects directory-only fields on file entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const configPath = join(root, "opencode-gateway.toml")

    try {
        await writeFile(join(root, "project.md"), "# Project")

        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "project.md",
                            description: "Project conventions",
                            globs: ["**/*.txt"],
                        },
                    ],
                },
                configPath,
            ),
        ).rejects.toThrow("only valid for directory entries")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects file-only fields on directory entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const configPath = join(root, "opencode-gateway.toml")

    try {
        await mkdir(join(root, "notes"), { recursive: true })

        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "notes",
                            description: "Long-lived notes",
                            inject_content: true,
                        },
                    ],
                },
                configPath,
            ),
        ).rejects.toThrow("only valid for file entries")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const configPath = join(root, "opencode-gateway.toml")

    try {
        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "missing.md",
                            description: "Missing",
                        },
                    ],
                },
                configPath,
            ),
        ).rejects.toThrow("does not exist")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
