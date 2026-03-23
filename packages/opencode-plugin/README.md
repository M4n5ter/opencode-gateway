# opencode-gateway

Gateway plugin for OpenCode.

## Quick Start

Initialize your OpenCode config:

```bash
npx opencode-gateway init
```

This ensures:

- `plugin: ["opencode-gateway"]` exists in `opencode.json`
- `opencode-gateway.toml` exists next to `opencode.json`

By default the CLI uses `OPENCODE_CONFIG_DIR` when it is set, otherwise it
writes to:

- `~/.config/opencode/opencode.json`
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
```

When Telegram is enabled, export the bot token through the configured
environment variable, for example:

```bash
export TELEGRAM_BOT_TOKEN="..."
```
