import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveOpencodeConfigFile } from "./opencode-config-file"

test("resolveOpencodeConfigFile prefers opencode.jsonc when both config files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-opencode-config-"))

    try {
        await mkdir(root, { recursive: true })
        await writeFile(join(root, "opencode.json"), "{}\n")
        await writeFile(join(root, "opencode.jsonc"), "{}\n")

        const resolved = await resolveOpencodeConfigFile(root)

        expect(resolved).toEqual({
            path: join(root, "opencode.jsonc"),
            exists: true,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("resolveOpencodeConfigFile falls back to opencode.json when jsonc is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-opencode-config-"))

    try {
        await mkdir(root, { recursive: true })
        await writeFile(join(root, "opencode.json"), "{}\n")

        const resolved = await resolveOpencodeConfigFile(root)

        expect(resolved).toEqual({
            path: join(root, "opencode.json"),
            exists: true,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("resolveOpencodeConfigFile defaults to creating opencode.jsonc", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-opencode-config-"))

    try {
        const resolved = await resolveOpencodeConfigFile(root)

        expect(resolved).toEqual({
            path: join(root, "opencode.jsonc"),
            exists: false,
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
