---
name: markdown-agents
description: Create, inspect, migrate, and maintain OpenCode markdown agents under .opencode/agents or ~/.config/opencode/agents, including frontmatter, permissions, provider options, examples, and restart workflow.
compatibility: opencode
metadata:
  domain: agents
  format: markdown
---

# Markdown Agents

Use this skill when the user wants to manage OpenCode agents through Markdown files rather than JSON config.

This skill is responsible for:

- explaining how Markdown-defined agents are discovered
- choosing the correct scope: project-local or global
- creating or editing agent files
- reviewing existing agent prompts and frontmatter
- migrating older agent configs to the current preferred shape
- validating permissions, naming, and restart steps

## When To Use This Skill

Use it for requests like:

- "create a review agent"
- "make this agent read-only"
- "show me all supported frontmatter fields"
- "move this agent from global to project-local"
- "why is this new agent not taking effect"
- "review this agent prompt and clean it up"

## Default Position

- Prefer project-local `.opencode/agents/` unless the user explicitly asks for a global change.
- Treat one Markdown file as one agent.
- Treat the filename as the agent name.
- Prefer `permission` over deprecated `tools`.
- Prefer `steps` over deprecated `maxSteps`.
- Put the actual system prompt in the Markdown body, not in frontmatter.
- Read existing agent files before editing so you preserve intentional conventions.
- If multiple files define the same agent name, call out the conflict instead of silently picking one.
- After creating or updating an agent, remind the user to reload or restart OpenCode. In gateway-managed sessions, prefer `gateway_restart`.

## Recommended Workflow

1. Decide the target scope first: `.opencode/agents/` or `~/.config/opencode/agents/`.
2. Inspect any existing agent with the same name before writing a new file.
3. Decide whether the agent should be `primary`, `subagent`, or `all`.
4. Write concise frontmatter that encodes behavior through config where possible.
5. Write the real behavioral instructions in the Markdown body.
6. Validate filename, YAML, permissions, deprecated fields, and restart guidance.

## What To Read Next

- For path, naming, and conflict rules: `references/discovery-and-scope.md`
- For frontmatter semantics and supported options: `references/frontmatter-and-options.md`
- For reusable templates and concrete agent examples: `references/workflows-and-examples.md`
- For final review before handing the change back: `references/validation-checklist.md`

## Important Rules

- In OpenCode's Markdown agent loader, the Markdown body becomes the final `prompt`.
- `description` is effectively required in practice even if the schema is permissive in some code paths.
- `hidden` only matters for `mode: subagent`.
- Ordered permission objects such as `permission.bash` and `permission.task` are order-sensitive; the last matching rule wins.
- Unknown top-level frontmatter keys are collected into model `options`, which is useful for provider-specific fields but should still be kept deliberate and readable.

## Expected Outputs

When this skill triggers, the result should usually be one of:

- an explanation of which file should be created or edited
- a new Markdown agent file
- an update to an existing agent's frontmatter or prompt body
- a migration from deprecated fields to recommended ones
- a review of an existing agent with concrete findings and suggested fixes

## Sources

- OpenCode agents docs: https://opencode.ai/docs/en/agents/#markdown
- OpenCode source config schema: https://github.com/sst/opencode/blob/dev/packages/opencode/src/config/config.ts
