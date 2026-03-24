# opencode-gateway

Gateway plugin for OpenCode.

## Quick Start

Initialize your OpenCode config:

```bash
npx opencode-gateway init
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
npx opencode-gateway doctor
```

Then start OpenCode normally:

```bash
opencode serve
```

If you want a separate managed config tree instead of editing your existing
OpenCode config:

```bash
npx opencode-gateway init --managed
export OPENCODE_CONFIG="$HOME/.config/opencode-gateway/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-gateway/opencode"
opencode serve
```

## Example gateway config

```toml
[gateway]
state_db = "/home/you/.local/share/opencode-gateway/state.db"
# log_level = "warn"

[cron]
enabled = true
tick_seconds = 5
max_concurrent_runs = 1

[channels.telegram]
enabled = false
bot_token_env = "TELEGRAM_BOT_TOKEN"
poll_timeout_seconds = 25
allowed_chats = []
allowed_users = []

[[memory.entries]]
path = "memory/project.md"
description = "Project conventions and long-lived context"
inject_content = true

[[memory.entries]]
path = "memory/notes"
description = "Domain notes and operating docs"
inject_markdown_contents = true
globs = ["**/*.rs", "notes/**/*.txt"]
```

When Telegram is enabled, export the bot token through the configured
environment variable, for example:

```bash
export TELEGRAM_BOT_TOKEN="..."
```

Gateway plugin logs are off by default. Set `gateway.log_level` to `error`,
`warn`, `info`, or `debug` to emit that level and anything above it.

Memory rules:

- all entries inject their configured path and description
- file contents are injected only when `inject_content = true`
- directory entries default to description-only
- `inject_markdown_contents = true` recursively injects `*.md` and `*.markdown`
- `globs` are relative to the configured directory and may match other UTF-8
  text files
- relative paths are resolved from `opencode-gateway.toml`
- memory is injected only into gateway-managed sessions
