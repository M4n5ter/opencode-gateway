# Opencode Gateway

Gateway plugin for OpenCode.

This repository contains two things:

- a publishable npm package: `opencode-gateway`
- the Rust/Bun workspace used to develop, test, and ship it

The recommended user path is the npm package. The repository path is for local
development and debugging.

## Use Through npm

### 1. Initialize your OpenCode config

Run:

```bash
npx opencode-gateway init
```

By default this uses `OPENCODE_CONFIG_DIR` when it is set, otherwise it writes
into your standard OpenCode config directory:

- `~/.config/opencode/opencode.jsonc` when absent, otherwise existing `opencode.jsonc` or `opencode.json`
- `~/.config/opencode/opencode-gateway.toml`

`init` will:

- create `opencode.jsonc` when neither config file exists
- prefer an existing `opencode.jsonc` over `opencode.json`
- ensure `plugin` contains `opencode-gateway@latest`
- create `opencode-gateway.toml` when it does not exist

If you want a separate managed config tree instead of touching your existing
OpenCode config, use:

```bash
npx opencode-gateway init --managed
```

That writes:

- `~/.config/opencode-gateway/opencode/opencode.jsonc`
- `~/.config/opencode-gateway/opencode/opencode-gateway.toml`

### 2. Configure the gateway

Edit `opencode-gateway.toml`. Minimal example:

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
# timezone = "Asia/Shanghai"

[channels.telegram]
enabled = false
bot_token_env = "TELEGRAM_BOT_TOKEN"
poll_timeout_seconds = 25
# Configure at least one allowlist when Telegram is enabled.
allowed_chats = []
allowed_users = []

[[memory.entries]]
path = "USER.md"
description = "Persistent user profile and preference memory. Keep this file accurate and concise. Record stable preferences, communication style, workflow habits, project conventions, tool constraints, review expectations, and other recurring facts that should shape future assistance. Update it proactively when you learn something durable about the user. Do not store one-off task details or transient context here."
inject_content = true

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

When `cron.timezone` is omitted, recurring cron expressions are interpreted in
the runtime's local time zone.

Gateway plugin logs are disabled by default. Set `gateway.log_level` to one of
`error`, `warn`, `info`, or `debug` to print that level and anything above it.

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
- directory `globs` are evaluated relative to the configured directory and define
  which files are auto-injected; other UTF-8 text files remain searchable on demand
- relative paths are resolved from `opencode-gateway-workspace`
- absolute paths are still allowed
- missing files and directories are created automatically on load
- the default template includes `USER.md` as persistent user-profile memory
- memory is injected only into gateway-managed sessions, including scheduled
  runs and channel-bound sessions
- `memory_search` returns matching snippets and paths; `memory_get` reads a
  specific configured memory file by path and optional line window

### 3. Verify the generated config

Run:

```bash
npx opencode-gateway doctor
```

This reports:

- the resolved config directory
- whether `opencode.json` exists
- whether `opencode-gateway.toml` exists
- whether `opencode-gateway` is present in the `plugin` array
- whether `TELEGRAM_BOT_TOKEN` is set
- which server origin and workspace directory `opencode-gateway warm` will use

### 4. Start OpenCode

Recommended:

```bash
opencode-gateway serve
```

This wraps `opencode serve` and immediately warms the gateway plugin worker, so
Telegram polling and scheduled jobs start without waiting for a manual
project-scoped request.

If you still prefer to run OpenCode directly, warm the gateway explicitly after
startup:

```bash
opencode serve
opencode-gateway warm
```

If you used `--managed`, start through the wrapper with the same flag:

```bash
opencode-gateway serve --managed
```

If you need the raw OpenCode command instead, set the managed config directory
first and then warm the gateway explicitly:

```bash
export OPENCODE_CONFIG="$HOME/.config/opencode-gateway/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-gateway/opencode"
opencode serve
opencode-gateway warm --managed
```

If Telegram is enabled, also export:

```bash
export TELEGRAM_BOT_TOKEN="..."
```

## Develop From This Repository

This path is for working on the plugin itself.

### Install dependencies

```bash
bun install
```

### Build the Rust wasm binding

```bash
bun run build:binding
```

This generates the package-local `wasm-bindgen` output under:

```text
packages/opencode-plugin/generated/wasm/pkg/
```

### Run the managed local launcher

The launcher keeps using a repository-local plugin loader for development.

Initialize managed files:

```bash
cargo run -p opencode-gateway-launcher -- init
```

This creates:

- `~/.config/opencode-gateway/opencode/opencode.json`
- `~/.config/opencode-gateway/opencode/opencode-gateway.toml`
- `~/.config/opencode-gateway/opencode/plugins/opencode-gateway.ts`

Start the managed OpenCode instance:

```bash
cargo run -p opencode-gateway-launcher -- serve
```

Useful helper:

```bash
cargo run -p opencode-gateway-launcher -- doctor
```

### Run checks

```bash
bun run check:binding
bun run check:plugin
cargo test
cargo clippy --all-targets --all-features
```

## Publish The npm Package

From the package directory:

```bash
cd packages/opencode-plugin
npm pack --dry-run
```

`prepack` builds both the package-local wasm output and the TypeScript `dist`
tree, so the tarball is self-contained and does not depend on repository-root
artifacts.

For a full release flow from the repository root, use:

```bash
node scripts/publish-npm.mjs
```

That runs the binding smoke check, plugin check, Rust test/clippy, and
`npm pack --dry-run`. Add `--publish` to actually publish:

```bash
node scripts/publish-npm.mjs --publish
```
