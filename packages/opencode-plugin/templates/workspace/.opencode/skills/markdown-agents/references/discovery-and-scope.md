# Discovery And Scope

## Preferred Directories

OpenCode documents two supported directories for Markdown agents:

- Project-local: `.opencode/agents/`
- Global: `~/.config/opencode/agents/`

For gateway-managed workspaces, prefer the project-local directory by default because it:

- keeps behavior versioned with the repository
- avoids polluting the user's global OpenCode environment
- makes project-specific agents easier to reason about and review

Prefer the global directory only when:

- the user explicitly asks for a global agent
- the agent is clearly intended to be reused across unrelated projects
- the task is specifically about maintaining a personal global OpenCode setup

## Filename Equals Agent Name

For Markdown agents, the filename becomes the agent name.

Examples:

- `.opencode/agents/review.md` -> `review`
- `.opencode/agents/security-auditor.md` -> `security-auditor`

Consequences:

- renaming the file renames the agent
- moving a file without changing its basename preserves the agent name
- duplicate basenames across different directories create ambiguity that should be surfaced

## One File, One Agent

Do not pack multiple agents into one file and do not split one agent across multiple files.

The stable shape is:

- one Markdown file
- one YAML frontmatter block
- one Markdown body that serves as the prompt

## Naming Guidance

Prefer names that are:

- short
- specific
- role-oriented
- easy to mention with `@`

Good names:

- `review`
- `docs-writer`
- `security-auditor`
- `orchestrator-planner`

Poor names:

- `agent1`
- `new-agent-final`
- names that only make sense for one temporary task

## Duplicate Name Handling

If the same agent name exists in both project-local and global directories:

- do not assume the user knows which one is active
- do not assume the default precedence is the user's intended target
- list the conflicting paths before editing anything

Recommended approach:

1. find all files that define the requested agent name
2. decide whether the request is project-specific or global
3. edit only the intended file
4. if needed, recommend removing or renaming the other copy

## What The Loader Actually Does

In OpenCode source, the Markdown loader parses frontmatter into config data and uses the trimmed Markdown body as the final `prompt`.

The current loader also derives names from path patterns such as:

- `/.opencode/agent/`
- `/.opencode/agents/`
- `/agent/`
- `/agents/`

Those details are useful for understanding behavior, but for user-facing guidance you should still anchor on the documented directories:

- `.opencode/agents/`
- `~/.config/opencode/agents/`

## Reload Expectations

After creating or editing a Markdown agent, the running OpenCode instance usually needs a reload or restart before the change is reliably visible.

For gateway-managed sessions:

- prefer `gateway_restart`

For manually started `opencode serve` sessions:

- restart the OpenCode process directly

Do not describe `warm` as a reload mechanism. `warm` only preloads the plugin runtime.
