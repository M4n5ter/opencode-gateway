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

Recommended user-facing commands use `bunx` with the published latest package:

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

[[memory.entries]]
path = "USER.md"
description = "Persistent user profile and preference memory. Keep this file accurate and concise. Record stable preferences, communication style, workflow habits, project conventions, tool constraints, review expectations, and other recurring facts that should shape future assistance. Update it proactively when you learn something durable about the user. Do not store one-off task details or transient context here."
inject_content = true

[[memory.entries]]
path = "RULES.md"
description = "Behavior rules and standing operating constraints for the assistant. Keep this file concise, explicit, and current. Use it for durable expectations about behavior, review standards, output style, safety boundaries, and other rules that should consistently shape future responses."
inject_content = true

[[memory.entries]]
path = "memory/daily"
description = "Daily notes stored as YYYY-MM-DD.md files. Use this directory for dated logs, short-lived findings, and day-specific working context that should remain searchable without being auto-injected."
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
- file contents are auto-injected only when `inject_content = true`
- `search_only = true` keeps an entry available to `memory_search` and `memory_get`
  without auto-injecting its content
- directory entries default to description-only plus on-demand search
- directory `globs` are relative to the configured directory and define which
  files are auto-injected; other UTF-8 text files remain searchable on demand
- relative paths are resolved from `opencode-gateway-workspace`
- absolute paths are still allowed
- missing files and directories are created automatically on load
- the default template includes `USER.md`, `RULES.md`, and `memory/daily`
- memory is injected only into gateway-managed sessions
- `memory_search` returns matching snippets and paths; `memory_get` reads a
  specific configured memory file by path and optional line window
