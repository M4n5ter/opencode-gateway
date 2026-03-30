# Validation Checklist

## Before Editing

- is the target directory correct: project-local or global
- have you checked for an existing agent with the same name
- does the filename match the intended agent name
- is a new agent actually necessary, or should an existing one be updated

## Frontmatter Checks

- is the YAML valid
- is `description` specific enough to support discovery and invocation
- does `mode` match the intended usage
- is `hidden` only being used for a subagent
- is `permission` being used instead of deprecated `tools`
- are deprecated fields like `tools` or `maxSteps` still lingering unnecessarily
- is `steps` set to a reasonable value
- is `color` either a valid hex or a supported theme token
- are provider-specific options kept readable instead of scattered thoughtlessly

## Permission Checks

- do the write/run boundaries match user intent
- are ordered permission objects such as `permission.bash` and `permission.task` written in the correct order
- do broad fallback rules appear before narrower overrides
- is the agent over-permissioned
- are any restrictions duplicated in both permissions and prompt text when one would be enough

## Prompt Checks

- does the Markdown body clearly express the agent's role and output expectations
- does it avoid repeating generic global behavior that is already enforced elsewhere
- is the prompt consistent with the frontmatter
- if the agent is a reviewer, planner, or auditor, does it make the priority order explicit

## Migration Checks

When updating older agents, also check:

- should `tools` be migrated to `permission`
- should `maxSteps` be migrated to `steps`
- should a frontmatter `prompt` be moved into the body
- did a filename change accidentally rename the agent

## Activation Checks

After changes, remind the user:

- new or updated agents usually require reload or restart
- in gateway-managed sessions, prefer `gateway_restart`
- in manual `opencode serve` sessions, restart the process directly

## Review Output Pattern

If the user asks you to review an existing agent config, default to checking:

- naming and scope
- description quality
- permission width
- `mode`, `hidden`, and `permission.task` coherence
- deprecated fields still in use
- whether the prompt actually matches the intended role
