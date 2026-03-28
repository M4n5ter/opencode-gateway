import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const USER_MEMORY_TEMPLATE = [
    "# USER",
    "",
    "Use this file for durable user profile and preference memory.",
    "",
    "- Update it proactively when you learn a stable preference, workflow habit, review expectation, or recurring constraint.",
    "- Keep it concise and deduplicated.",
    "- Do not store one-off task details or day-specific notes here.",
    "",
].join("\n")

const RULES_MEMORY_TEMPLATE = [
    "# RULES",
    "",
    "Use this file for durable assistant behavior rules and standing operating constraints.",
    "",
    "- Update it proactively when a new long-lived rule, boundary, or style expectation becomes clear.",
    "- Keep it explicit, concise, and deduplicated.",
    "- Do not mix day-specific task notes into this file.",
    "",
].join("\n")

const DAILY_MEMORY_README_TEMPLATE = [
    "# Daily Notes",
    "",
    "Store day-specific notes here as `YYYY-MM-DD.md` files.",
    "",
    "Use daily notes for dated progress logs, investigation breadcrumbs, temporary decisions, and other context that should remain searchable without becoming durable user or rules memory.",
    "",
    "Create or update the current day's file proactively when there is meaningful new day-specific context to preserve.",
    "",
].join("\n")

const WORKSPACE_SKILLS_README_TEMPLATE = [
    "# Workspace Skills",
    "",
    "Put gateway-local OpenCode skills in this directory.",
    "",
    "Gateway-managed sessions default to this workspace-local `.opencode/skills` directory when creating, installing, or updating skills.",
    "",
    "OpenCode may still read globally configured skills, but new or maintained gateway skills should live here unless the user explicitly asks for a global change.",
    "",
].join("\n")

export async function ensureGatewayWorkspaceScaffold(workspaceDirPath: string): Promise<void> {
    await mkdir(workspaceDirPath, { recursive: true })
    await mkdir(join(workspaceDirPath, "memory", "daily"), { recursive: true })
    await mkdir(join(workspaceDirPath, ".opencode", "skills"), { recursive: true })

    await writeFileIfMissing(join(workspaceDirPath, "USER.md"), USER_MEMORY_TEMPLATE)
    await writeFileIfMissing(join(workspaceDirPath, "RULES.md"), RULES_MEMORY_TEMPLATE)
    await writeFileIfMissing(join(workspaceDirPath, "memory", "daily", "README.md"), DAILY_MEMORY_README_TEMPLATE)
    await writeFileIfMissing(
        join(workspaceDirPath, ".opencode", "skills", "README.md"),
        WORKSPACE_SKILLS_README_TEMPLATE,
    )
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
    if (await pathExists(path)) {
        return
    }

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { flag: "wx" })
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false
        }

        throw error
    }
}
