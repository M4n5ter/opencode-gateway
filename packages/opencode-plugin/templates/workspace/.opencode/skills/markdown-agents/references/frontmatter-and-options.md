# Frontmatter And Options

## Overview

A Markdown agent file has two parts:

1. YAML frontmatter
2. a Markdown body that becomes the agent prompt

Basic shape:

```md
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
---

You are a code reviewer.
Focus on correctness, maintainability, and security.
```

## Field Reference

### `description`

- purpose: explains what the agent does and when it should be used
- practice: treat it as required
- source nuance: some schema paths are permissive, but omitting it makes the agent harder to discover and reason about

Good:

```yaml
description: Reviews code for correctness, maintainability, and security without editing files
```

Weak:

```yaml
description: reviewer
```

### `mode`

Supported values:

- `primary`
- `subagent`
- `all`

Use:

- `primary` for agents intended to be the main conversation agent
- `subagent` for agents invoked by other agents or via `@name`
- `all` only when both use modes are genuinely intended

If omitted, documented behavior defaults to `all`.

### `model`

Usually written as:

```yaml
model: provider/model-id
```

Example:

```yaml
model: openai/gpt-5
```

Only override the model when the agent truly needs a different capability, latency, or cost profile from the default.

### `variant`

Lets the agent choose a default model variant when the configured model supports one.

This field is supported by the OpenCode source schema even though it is less prominent in the public Markdown examples.

### `temperature`

- lower values: more focused and deterministic
- higher values: more creative and varied

Typical ranges:

- review / plan / audit: `0.0` to `0.2`
- general development: `0.2` to `0.5`
- ideation / brainstorming: `0.6` to `1.0`

### `top_p`

Another sampling control that affects response diversity.

Guidance:

- do not aggressively tune both `temperature` and `top_p` without a reason
- for predictable agents, prefer changing one knob at a time

### `steps`

Limits the maximum number of agentic iterations.

This is the recommended field for new configs.

### `maxSteps`

Deprecated.

OpenCode source still maps `maxSteps` into `steps`, but new configs and edits should prefer `steps`.

### `disable`

Set to `true` to disable the agent while keeping the file around.

Useful for:

- temporary retirement
- staged rollout
- keeping an example or template checked in without enabling it

### `hidden`

Hides a subagent from the `@` autocomplete UI.

Important:

- only meaningful for `mode: subagent`
- does not by itself prevent model-driven Task invocation
- real invocation control still comes from permissions, especially `permission.task`

### `color`

Supported values:

- 6-digit hex colors such as `#FF5733`
- theme colors such as `primary`, `secondary`, `accent`, `success`, `warning`, `error`, `info`

This is presentation-only.

### `permission`

This is the preferred modern way to manage tool access.

The OpenCode source schema currently includes built-in support for keys such as:

- `read`
- `edit`
- `glob`
- `grep`
- `list`
- `bash`
- `task`
- `external_directory`
- `todowrite`
- `question`
- `webfetch`
- `websearch`
- `codesearch`
- `lsp`
- `doom_loop`
- `skill`

It also accepts additional keys, so agent-specific permissions can still target other tool names.

Permissions have two shapes:

1. direct actions:

```yaml
permission:
  edit: deny
  webfetch: ask
```

2. rule objects:

```yaml
permission:
  bash:
    "*": ask
    "git diff": allow
    "git log*": allow
```

Allowed actions:

- `ask`
- `allow`
- `deny`

#### Ordering Rules

OpenCode preserves original permission object key order before evaluation.

For ordered rule objects such as `permission.bash` and `permission.task`:

- the last matching rule wins

So broad rules should come first and narrower rules later:

```yaml
permission:
  bash:
    "*": ask
    "git status *": allow
```

### `permission.task`

Controls which subagents the agent may invoke via the Task tool.

Example:

```yaml
permission:
  task:
    "*": deny
    "review": allow
    "docs-*": ask
```

This matters most for orchestrator-style agents.

### `tools`

Deprecated.

OpenCode still maps legacy `tools` into `permission`:

- `true` -> `allow`
- `false` -> `deny`
- `write`, `edit`, `patch`, and `multiedit` map to `permission.edit`

So:

- you still need to understand it when maintaining older files
- you should migrate away from it when updating agents

### `prompt`

The general agent schema supports a `prompt` field, but for Markdown agents:

- the loader sets `prompt` from the Markdown body
- the body therefore overrides any frontmatter `prompt`

So for Markdown agents, put the real prompt in the body, not in frontmatter.

### `options`

You can explicitly group provider-specific options:

```yaml
options:
  reasoningEffort: high
  textVerbosity: low
```

### Additional Top-Level Fields

OpenCode's agent schema uses `catchall(z.any())` and then moves unknown top-level keys into `options`.

That means this is also valid:

```yaml
reasoningEffort: high
textVerbosity: low
```

Guidance:

- for a small number of provider-specific fields, top-level can be acceptable
- when there are several related model options, explicit `options:` is clearer
- do not use this escape hatch to turn frontmatter into a grab bag

## Recommended Shape For New Markdown Agents

Default to:

- `description`
- `mode`
- `model` only when needed
- `temperature` or `top_p` only when needed
- `steps`
- `permission`
- `hidden` or `color` only when they add value
- a Markdown body prompt

Avoid defaulting to:

- `tools`
- `maxSteps`
- frontmatter `prompt`
