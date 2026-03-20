# Opencode Gateway

## Installation

This repository supports two installation flows:

1. use the wrapped launcher provided by this repo
2. wire the plugin into `opencode` manually

In both cases, start from the repository root and build the local WebAssembly binding first:

```bash
bun install
bun run build:binding
```

The generated `wasm-bindgen` package is required before the plugin can load.

### Option A: Use the Wrapped Launcher

The launcher prepares a managed OpenCode config directory under
`~/.config/opencode-gateway/opencode/`, creates a plugin loader, warms the current
project instance, and starts `opencode serve` with the correct environment variables.

1. Initialize the managed files:

```bash
cargo run -p opencode-gateway-launcher -- init
```

2. Edit the generated gateway config:

```text
~/.config/opencode-gateway/config.toml
```

At minimum, set `channels.telegram.enabled = true`, configure an explicit allowlist,
and export the bot token through the environment if you want Telegram enabled.

3. Start the managed OpenCode server:

```bash
cargo run -p opencode-gateway-launcher -- serve
```

Useful helper:

```bash
cargo run -p opencode-gateway-launcher -- doctor
```

### Option B: Use `opencode` Directly

If you prefer to manage OpenCode yourself, create your own managed config
directory and point OpenCode at it explicitly.

1. Create a config root:

```bash
mkdir -p ~/.config/opencode-gateway/opencode/plugins
mkdir -p ~/.local/share/opencode-gateway
```

2. Create the gateway config at:

```text
~/.config/opencode-gateway/config.toml
```

Example:

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

3. Create the OpenCode config at:

```text
~/.config/opencode-gateway/opencode/opencode.json
```

Example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "hostname": "127.0.0.1",
    "port": 4096
  }
}
```

4. Create the plugin loader at:

```text
~/.config/opencode-gateway/opencode/plugins/opencode-gateway.ts
```

Replace `<REPO_ROOT>` with the absolute path to this repository:

```ts
export { default, OpencodeGatewayPlugin } from "file://<REPO_ROOT>/packages/opencode-plugin/src/index.ts"
```

5. Start OpenCode with the managed config:

```bash
export OPENCODE_CONFIG="$HOME/.config/opencode-gateway/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-gateway/opencode"
opencode serve
```

If Telegram is enabled, also export:

```bash
export TELEGRAM_BOT_TOKEN="..."
```
