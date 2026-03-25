import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GatewayMemoryConfig } from "../config/memory"
import { GatewayMemoryRuntime } from "./runtime"

test("GatewayMemoryRuntime searches directory text files but skips binary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-runtime-"))
    const memoryDir = join(root, "memory")

    try {
        await mkdir(join(memoryDir, "notes"), { recursive: true })
        await writeFile(join(memoryDir, "notes", "project.md"), "alpha beta\nsecond line")
        await writeFile(join(memoryDir, "notes", "ops.txt"), "beta only")
        await writeFile(join(memoryDir, "notes", "blob.bin"), new Uint8Array([0x00, 0x01]))

        const runtime = new GatewayMemoryRuntime(
            {
                entries: [
                    {
                        kind: "directory",
                        path: memoryDir,
                        displayPath: "memory",
                        description: "Notes",
                        globs: [],
                        searchOnly: true,
                    },
                ],
            },
            { log() {} },
        )

        const results = await runtime.search("alpha beta", 5)

        expect(results).toHaveLength(1)
        expect(results[0]).toEqual({
            path: "memory/notes/project.md",
            description: "Notes",
            lineStart: 1,
            lineEnd: 2,
            snippet: "alpha beta\nsecond line",
            infoString: "md",
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryRuntime reads a configured file by display path and line window", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-runtime-"))
    const memoryFile = join(root, "USER.md")

    try {
        await writeFile(memoryFile, ["line 1", "line 2", "line 3"].join("\n"))

        const config: GatewayMemoryConfig = {
            entries: [
                {
                    kind: "file",
                    path: memoryFile,
                    displayPath: "USER.md",
                    description: "User profile",
                    injectContent: true,
                    searchOnly: false,
                },
            ],
        }

        const result = await new GatewayMemoryRuntime(config, { log() {} }).get("USER.md", 2, 2)

        expect(result).toEqual({
            path: "USER.md",
            description: "User profile",
            lineStart: 2,
            lineEnd: 3,
            text: "line 2\nline 3",
            infoString: "md",
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("GatewayMemoryRuntime rejects unknown memory_get paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-memory-runtime-"))

    try {
        const config: GatewayMemoryConfig = {
            entries: [],
        }

        await expect(new GatewayMemoryRuntime(config, { log() {} }).get("missing.md")).rejects.toThrow(
            "memory path was not found",
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
