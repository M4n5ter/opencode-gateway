import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseMemoryConfig } from "./memory"

test("parseMemoryConfig resolves relative file entries against the gateway workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const filePath = join(workspaceDirPath, "memory", "project.md")

    try {
        await mkdir(join(workspaceDirPath, "memory"), { recursive: true })
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
            workspaceDirPath,
        )

        expect(config).toEqual({
            entries: [
                {
                    kind: "file",
                    path: filePath,
                    displayPath: "memory/project.md",
                    description: "Project conventions",
                    injectContent: true,
                    searchOnly: false,
                },
            ],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig parses directory entries and keeps glob patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const directoryPath = join(workspaceDirPath, "notes")

    try {
        await mkdir(directoryPath, { recursive: true })

        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "notes",
                        description: "Long-lived notes",
                        globs: ["**/*.md", "ops/**/*.yaml"],
                    },
                ],
            },
            workspaceDirPath,
        )

        expect(config).toEqual({
            entries: [
                {
                    kind: "directory",
                    path: directoryPath,
                    displayPath: "notes",
                    description: "Long-lived notes",
                    globs: ["**/*.md", "ops/**/*.yaml"],
                    searchOnly: false,
                },
            ],
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects the removed inject_markdown_contents option", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")

    try {
        await mkdir(join(workspaceDirPath, "notes"), { recursive: true })

        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "notes",
                            description: "Long-lived notes",
                            inject_markdown_contents: true,
                        },
                    ],
                },
                workspaceDirPath,
            ),
        ).rejects.toThrow("inject_markdown_contents has been removed")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects directory-only fields on file entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")

    try {
        await mkdir(workspaceDirPath, { recursive: true })
        await writeFile(join(workspaceDirPath, "project.md"), "# Project")

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
                workspaceDirPath,
            ),
        ).rejects.toThrow("only valid for directory entries")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects file-only fields on directory entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")

    try {
        await mkdir(join(workspaceDirPath, "notes"), { recursive: true })

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
                workspaceDirPath,
            ),
        ).rejects.toThrow("only valid for file entries")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects inject_content when search_only is enabled on a file entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const filePath = join(workspaceDirPath, "USER.md")

    try {
        await mkdir(workspaceDirPath, { recursive: true })
        await writeFile(filePath, "# User")

        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "USER.md",
                            description: "User profile",
                            inject_content: true,
                            search_only: true,
                        },
                    ],
                },
                workspaceDirPath,
            ),
        ).rejects.toThrow("cannot enable both inject_content and search_only")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig rejects globs when search_only is enabled on a directory entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const directoryPath = join(workspaceDirPath, "notes")

    try {
        await mkdir(directoryPath, { recursive: true })

        await expect(
            parseMemoryConfig(
                {
                    entries: [
                        {
                            path: "notes",
                            description: "Long-lived notes",
                            globs: ["**/*.md"],
                            search_only: true,
                        },
                    ],
                },
                workspaceDirPath,
            ),
        ).rejects.toThrow("cannot enable both globs and search_only")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig creates a missing file entry when the path looks like a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const filePath = join(workspaceDirPath, "missing.md")

    try {
        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "missing.md",
                        description: "Missing",
                    },
                ],
            },
            workspaceDirPath,
        )

        expect(config.entries[0]).toEqual({
            kind: "file",
            path: filePath,
            displayPath: "missing.md",
            description: "Missing",
            injectContent: false,
            searchOnly: false,
        })
        expect(await stat(filePath)).toBeDefined()
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig creates a missing directory entry when glob injection is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const directoryPath = join(workspaceDirPath, "memory", "daily")

    try {
        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "memory/daily",
                        description: "Daily notes",
                        globs: ["**/*.md"],
                    },
                ],
            },
            workspaceDirPath,
        )

        expect(config.entries[0]).toEqual({
            kind: "directory",
            path: directoryPath,
            displayPath: "memory/daily",
            description: "Daily notes",
            globs: ["**/*.md"],
            searchOnly: false,
        })
        expect((await stat(directoryPath)).isDirectory()).toBe(true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig keeps absolute paths untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const filePath = join(root, "external", "project.md")

    try {
        await mkdir(join(root, "external"), { recursive: true })
        await writeFile(filePath, "# Project")

        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: filePath,
                        description: "External memory",
                        search_only: true,
                    },
                ],
            },
            workspaceDirPath,
        )

        expect(config.entries[0]).toEqual({
            kind: "file",
            path: filePath,
            displayPath: filePath,
            description: "External memory",
            injectContent: false,
            searchOnly: true,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("parseMemoryConfig resolves parent traversals from the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-config-"))
    const workspaceDirPath = join(root, "opencode-gateway-workspace")
    const filePath = join(root, "shared", "project.md")

    try {
        await mkdir(join(root, "shared"), { recursive: true })
        await writeFile(filePath, "# Project")

        const config = await parseMemoryConfig(
            {
                entries: [
                    {
                        path: "../shared/project.md",
                        description: "Shared memory",
                    },
                ],
            },
            workspaceDirPath,
        )

        expect(config.entries[0]).toEqual({
            kind: "file",
            path: filePath,
            displayPath: "../shared/project.md",
            description: "Shared memory",
            injectContent: false,
            searchOnly: false,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
