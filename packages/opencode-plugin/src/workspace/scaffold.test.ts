import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureGatewayWorkspaceScaffold } from "./scaffold"

test("ensureGatewayWorkspaceScaffold creates default memory and skill templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-workspace-"))
    const workspaceDir = join(root, "opencode-gateway-workspace")

    try {
        await ensureGatewayWorkspaceScaffold(workspaceDir)

        expect(await readFile(join(workspaceDir, "USER.md"), "utf8")).toContain("Update it proactively")
        expect(await readFile(join(workspaceDir, "RULES.md"), "utf8")).toContain("Update it proactively")
        expect(await readFile(join(workspaceDir, "memory", "daily", "README.md"), "utf8")).toContain("YYYY-MM-DD.md")
        expect(await readFile(join(workspaceDir, ".opencode", "skills", "README.md"), "utf8")).toContain(
            "gateway-local OpenCode skills",
        )
        const markdownAgentsSkill = await readFile(
            join(workspaceDir, ".opencode", "skills", "markdown-agents", "SKILL.md"),
            "utf8",
        )
        expect(markdownAgentsSkill).toContain("name: markdown-agents")
        expect(markdownAgentsSkill).toContain("Prefer project-local `.opencode/agents/`")
        expect(
            await readFile(
                join(
                    workspaceDir,
                    ".opencode",
                    "skills",
                    "markdown-agents",
                    "references",
                    "frontmatter-and-options.md",
                ),
                "utf8",
            ),
        ).toContain("`permission.task`")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test("ensureGatewayWorkspaceScaffold preserves existing workspace files", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-gateway-workspace-"))
    const workspaceDir = join(root, "opencode-gateway-workspace")
    const userPath = join(workspaceDir, "USER.md")

    try {
        await mkdir(join(workspaceDir, "memory", "daily"), { recursive: true })
        await writeFile(userPath, "custom user memory\n")

        await ensureGatewayWorkspaceScaffold(workspaceDir)

        expect(await readFile(userPath, "utf8")).toBe("custom user memory\n")
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
