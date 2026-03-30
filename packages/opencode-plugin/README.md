# opencode-gateway

Gateway plugin for OpenCode.

## Stability Note

The gateway is still under fast iteration. Expect occasional regressions,
startup failures, or state/cache mismatches after upgrades.

When the installed package stops behaving correctly, these two cleanup steps
resolve a large share of issues:

- remove the gateway state database at `~/.local/share/opencode-gateway/state.db`
- remove the OpenCode plugin cache at `~/.cache/opencode/node_modules/opencode-gateway`

After that, run `bunx opencode-gateway@latest init` again if needed, then start
the gateway normally.

## Quick Start

Recommended user-facing commands use `bunx` with the latest version:

```bash
bunx opencode-gateway@latest <command>
```

If you prefer npm, replace `bunx` with:

```bash
npx opencode-gateway@latest <command>
```

Initialize your OpenCode config:

```bash
bunx opencode-gateway@latest init
```

This ensures:

- `plugin` contains `opencode-gateway@latest`
- `opencode-gateway.toml` exists next to the preferred OpenCode config file

By default the CLI uses `OPENCODE_CONFIG_DIR` when it is set, otherwise it
writes to:

- an existing `~/.config/opencode/opencode.jsonc` or `~/.config/opencode/opencode.json`
- otherwise a new `~/.config/opencode/opencode.jsonc`
- `~/.config/opencode/opencode-gateway.toml`

Check what it resolved:

```bash
bunx opencode-gateway@latest doctor
```

Recommended:

```bash
bunx opencode-gateway@latest serve
```

This wraps `opencode serve` and warms the gateway plugin worker immediately, so
Telegram polling and scheduled jobs do not stay idle until the first
project-scoped request.

If you still prefer the raw OpenCode command, warm the gateway explicitly after
startup:

```bash
opencode serve
bunx opencode-gateway@latest warm
```

If you want a separate managed config tree instead of editing your existing
OpenCode config:

```bash
bunx opencode-gateway@latest init --managed
bunx opencode-gateway@latest serve --managed
```

## Example gateway config

```toml
[gateway]
state_db = "/home/you/.local/share/opencode-gateway/state.db"
# log_level = "warn"

# Optional mailbox batching and route overrides.
# [gateway.mailbox]
# batch_replies = false
# batch_window_ms = 1500
#
# [[gateway.mailbox.routes]]
# channel = "telegram"
# target = "6212645712"
# topic = "12345"
# mailbox_key = "shared:telegram:dev"
#
# Optional execution timeouts. Defaults are long-task friendly:
# [gateway.execution]
# session_wait_timeout_ms = 1800000
# prompt_progress_timeout_ms = 1800000
# hard_timeout_ms = 7200000
# abort_settle_timeout_ms = 5000
#
# Optional policy for new inbound messages that arrive while the current
# mailbox run is still executing:
# [gateway.inflight_messages]
# default_policy = "ask" # "ask" | "queue" | "interrupt"

[cron]
enabled = true
tick_seconds = 5
max_concurrent_runs = 1

[channels.telegram]
enabled = false
# Ask @BotFather for the bot token. Choose exactly one credential source.
# bot_token = "123456:ABCDEF"
# Or load it from an environment variable:
bot_token_env = "TELEGRAM_BOT_TOKEN"
poll_timeout_seconds = 25
# Configure at least one allowlist when Telegram is enabled.
# Ask @userinfobot for your numeric Telegram user id for private-chat allowlists.
allowed_chats = []
allowed_users = []

[channels.telegram.ux]
# Control Telegram tool-call previews: "toggle", "inline", or "off".
# "toggle" keeps one preview message with Preview / Tools buttons.
tool_call_view = "toggle"
# Add a reaction after OpenCode compacts the session context.
compaction_reaction = true
compaction_reaction_emoji = "🗜️"

[[memory.entries]]
path = "USER.md"
description = "Persistent user profile and preference memory. Keep this file accurate and concise. Record stable preferences, communication style, workflow habits, project conventions, tool constraints, review expectations, and other recurring facts that should shape future assistance. Update it proactively when you learn something durable about the user. Do not store one-off task details or transient context here."
inject_content = true

[[memory.entries]]
path = "RULES.md"
description = "Behavior rules and standing operating constraints for the assistant. Keep this file concise, explicit, and current. Use it for durable expectations about behavior, review standards, output style, safety boundaries, and other rules that should consistently shape future responses. Update it proactively when new long-lived rules or boundaries become clear."
inject_content = true

[[memory.entries]]
path = "memory/daily"
description = "Daily notes stored as YYYY-MM-DD.md files. Use this directory for dated logs, short-lived findings, and day-specific working context that should remain searchable without being auto-injected. Create or update the current day's file proactively when meaningful new day-specific context appears."
search_only = true

[[memory.entries]]
path = "memory/project.md"
description = "Project conventions and long-lived context"
inject_content = true

[[memory.entries]]
path = "memory/notes"
description = "Domain notes and operating docs"
search_only = true

[[memory.entries]]
path = "memory/snippets"
description = "Selected files are auto-injected; the rest stay searchable on demand"
globs = ["**/*.md", "notes/**/*.txt"]
```

`[gateway.execution]` is optional. By default the gateway allows long-running
OpenCode tasks and only times out stalled waits: `session_wait_timeout_ms` and
`prompt_progress_timeout_ms` default to 30 minutes, `hard_timeout_ms` is
disabled, and `abort_settle_timeout_ms` defaults to 5 seconds.

`[gateway.inflight_messages]` is also optional. `default_policy` defaults to
`"ask"`:

- `ask` holds new inbound messages while the current mailbox run is still active
  and sends a local `Queue Next` / `Interrupt Current` interaction
- `queue` keeps the current run and automatically releases the held messages once
  that run finishes
- `interrupt` aborts the current run immediately and starts the held messages in
  the next run

Telegram UX defaults:

- private Telegram chats use one editable stream message instead of draft transport
- successful `permission` and `question` prompts are auto-removed shortly after reply
- `tool_call_view = "toggle"` uses one preview message with `Preview` / `Tools` buttons instead of mixing tool details into the main preview body
- the `Preview` view keeps `reasoning`, `process`, and the final answer visible; the `Tools` view paginates tool details newest-first
- when the task finishes, the message returns to `Preview`, but `Tools` stays available for later inspection
- the first tool event opens the preview stream immediately so pending/running tool input shows up early
- after OpenCode emits `session.compacted`, the current Telegram message gets a `🗜️` reaction by default
- when a new inbound message lands during an active mailbox run, Telegram can ask whether to queue it or interrupt the current run, depending on `gateway.inflight_messages.default_policy`

When Telegram is enabled, either set `channels.telegram.bot_token` directly or
export the token through the configured environment variable, for example:

```bash
export TELEGRAM_BOT_TOKEN="..."
```

Gateway plugin logs are off by default. Set `gateway.log_level` to `error`,
`warn`, `info`, or `debug` to emit that level and anything above it.

Mailbox rules:

- `gateway.mailbox.batch_replies` defaults to `false`
- `gateway.mailbox.batch_window_ms` defaults to `1500`
- `gateway.mailbox.routes` lets multiple ingress targets share one logical mailbox/session
- each route needs `channel`, `target`, optional `topic`, and a `mailbox_key`

Memory rules:

- all entries inject their configured path and description
- entry-specific maintenance guidance for `USER.md`, `RULES.md`, and `memory/daily` is injected only when those exact entries are configured
- file contents are auto-injected only when `inject_content = true`
- `search_only = true` keeps an entry available to `memory_search` and `memory_get`
  without auto-injecting its content
- directory entries default to description-only plus on-demand search
- directory `globs` are relative to the configured directory and define which
  files are auto-injected; other UTF-8 text files remain searchable on demand
- relative paths are resolved from `opencode-gateway-workspace`
- absolute paths are still allowed
- missing files and directories are created automatically on load
- the default workspace scaffold includes `USER.md`, `RULES.md`, `memory/daily/README.md`, `.opencode/skills/README.md`, and the built-in `.opencode/skills/markdown-agents/` guide
- the default template includes `USER.md`, `RULES.md`, and `memory/daily`
- gateway-managed sessions default to workspace-local skills under `opencode-gateway-workspace/.opencode/skills`
- globally configured OpenCode skills remain readable, but new or updated gateway skills should default to the workspace-local skills directory unless the user explicitly asks otherwise
- memory is injected only into gateway-managed sessions
- `memory_search` returns matching snippets and paths; `memory_get` reads a
  specific configured memory file by path and optional line window
