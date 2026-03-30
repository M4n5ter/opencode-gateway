import type { BindingDeliveryTarget } from "../binding"
import type { GatewayMemoryPromptProvider } from "../memory/prompt"
import type { GatewaySessionContext } from "./context"

export class GatewaySystemPromptBuilder {
    constructor(
        private readonly sessions: GatewaySessionContext,
        private readonly memory: GatewayMemoryPromptProvider,
    ) {}

    async buildPrompts(sessionId: string): Promise<string[]> {
        if (!this.sessions.isGatewaySession(sessionId)) {
            return []
        }

        const prompts: string[] = []
        const gatewayPrompt = buildGatewayContextPrompt(this.sessions.listReplyTargets(sessionId))
        if (gatewayPrompt !== null) {
            prompts.push(gatewayPrompt)
        }

        prompts.push(buildGatewaySkillsPrompt())

        const memoryPrompt = await this.memory.buildPrompt()
        if (memoryPrompt !== null) {
            prompts.push(memoryPrompt)
        }

        return prompts
    }
}

function buildGatewaySkillsPrompt(): string {
    return [
        "Gateway skills:",
        "- This gateway session uses a managed workspace-local skills directory at `.opencode/skills`.",
        "- You may read any skills already visible to OpenCode, including user-configured global skills.",
        "- When creating, installing, or updating a skill, default to `.opencode/skills` in the current gateway workspace unless the user explicitly asks for a global change.",
    ].join("\n")
}

function buildGatewayContextPrompt(targets: BindingDeliveryTarget[]): string | null {
    if (targets.length === 0) {
        return null
    }

    if (targets.length === 1) {
        const target = targets[0]
        return [
            "Gateway context:",
            `- Current message source channel: ${target.channel}`,
            `- Current reply target id: ${target.target}`,
            `- Current reply topic: ${target.topic ?? "none"}`,
            "- Unless the user explicitly asks otherwise, channel-aware actions should default to this target.",
            "- If the user asks which OpenCode primary agent is active for this route, use agent_status.",
            "- If the user asks to switch the OpenCode primary agent for this route, use agent_switch once they name the target agent.",
            "- If the user asks to reload or restart OpenCode so new skills, agents, or config changes take effect, use gateway_restart.",
            "- If the user asks to start a fresh channel session, use channel_new_session.",
            "- If the user asks for a one-shot reminder or relative-time follow-up, prefer schedule_once.",
            "- If the user asks for a recurring schedule, prefer cron_upsert.",
            "- Use schedule_list and schedule_status to inspect existing scheduled jobs and recent run results.",
            "- Scheduled results delivered to this channel are automatically appended to this session as context.",
        ].join("\n")
    }

    return [
        "Gateway context:",
        `- This session currently fans out to ${targets.length} reply targets.`,
        ...targets.map(
            (target, index) =>
                `- Target ${index + 1}: channel=${target.channel}, id=${target.target}, topic=${target.topic ?? "none"}`,
        ),
        "- If a tool needs a single explicit target, do not guess; ask the user or use explicit tool arguments.",
        "- If the user asks which OpenCode primary agent is active for this route, use agent_status.",
        "- If the user asks to switch the OpenCode primary agent for this route, inspect agent_status first unless they already named the target agent, then use agent_switch.",
        "- If the user asks to reload or restart OpenCode so new skills, agents, or config changes take effect, use gateway_restart.",
        "- If the user asks to start a fresh channel session for this route, use channel_new_session.",
        "- Prefer schedule_once for one-shot reminders and cron_upsert for recurring schedules.",
        "- Use schedule_list and schedule_status to inspect scheduled jobs and recent run results.",
    ].join("\n")
}
