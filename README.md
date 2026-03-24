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

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/opencode-gateway.toml`

`init` will:

- create `opencode.json` when it does not exist
- ensure `plugin: ["opencode-gateway"]` is present
- create `opencode-gateway.toml` when it does not exist

If you want a separate managed config tree instead of touching your existing
OpenCode config, use:

```bash
npx opencode-gateway init --managed
```

That writes:

- `~/.config/opencode-gateway/opencode/opencode.json`
- `~/.config/opencode-gateway/opencode/opencode-gateway.toml`

### 2. Configure the gateway

Edit `opencode-gateway.toml`. Minimal example:

```toml
[gateway]
state_db = "/home/you/.local/share/opencode-gateway/state.db"
# log_level = "warn"

[cron]
enabled = true
tick_seconds = 5
max_concurrent_runs = 1
# timezone = "Asia/Shanghai"

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

When `cron.timezone` is omitted, recurring cron expressions are interpreted in
the runtime's local time zone.

Gateway plugin logs are disabled by default. Set `gateway.log_level` to one of
`error`, `warn`, `info`, or `debug` to print that level and anything above it.

Memory rules:

- all entries inject their configured path and description
- file contents are injected only when `inject_content = true`
- directory entries default to description-only
- `inject_markdown_contents = true` recursively injects `*.md` and `*.markdown`
- `globs` are evaluated relative to the configured directory and may match other
  UTF-8 text files
- relative paths are resolved from `opencode-gateway.toml`
- memory is injected only into gateway-managed sessions, including scheduled
  runs and channel-bound sessions

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

### 4. Start OpenCode

If you used the default config directory:

```bash
opencode serve
```

If you used `--managed`, start OpenCode against that directory explicitly:

```bash
export OPENCODE_CONFIG="$HOME/.config/opencode-gateway/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-gateway/opencode"
opencode serve
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
