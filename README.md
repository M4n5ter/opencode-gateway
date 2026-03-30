# Opencode Gateway

Gateway plugin for OpenCode.

This repository is the Rust/Bun workspace behind `opencode-gateway`.

The recommended user path is the packaged CLI. The repository path is for local
development and debugging.

## Highlights

`opencode-gateway` is a local OpenCode automation gateway with a native
launcher, a managed plugin runtime, and durable state around conversations,
delivery, scheduling, and memory.

After the gateway is initialized and running, routine operation is meant to
happen through natural-language conversation with OpenCode rather than through a
catalog of special commands. The CLI is primarily for bootstrap, diagnostics,
and process management; day-to-day actions are exposed as conversational tools.

Current feature set, grouped by responsibility:

- Lifecycle and workspace management:
  `init`, `doctor`, and managed `serve`; immediate plugin warm-up; managed
  restart through `gateway_restart`; a workspace scaffold with `USER.md`,
  `RULES.md`, daily notes, workspace-local skills, and the built-in
  `markdown-agents` guide.
- Durable execution and routing:
  SQLite-backed session bindings and runtime journal; durable mailbox queues;
  per-mailbox serialization; optional reply batching; shared mailbox routes;
  inflight handling with `ask`, `queue`, and `interrupt`.
- Telegram delivery runtime:
  long polling with explicit allowlists; private-chat editable previews;
  Preview / Tools views with paginated tool history; file sending; compaction
  reactions; and automatic cleanup for permission/question interactions.
- Scheduling and automation:
  recurring cron jobs plus one-shot schedules; persisted job catalog and run
  history; operational tools for create, inspect, run, cancel, and status
  checks.
- Memory and agent operations:
  workspace-aware memory injection; `memory_search` and `memory_get`; route
  agent inspection and switching via `agent_status` and `agent_switch`; and
  fresh channel sessions via `channel_new_session`.

## Operational Note

The gateway is now suitable for regular day-to-day use through the packaged
CLI. Upgrades can still occasionally leave behind stale state or plugin cache
artifacts, so keep these cleanup steps in mind when an installed package stops
behaving correctly:

- remove the gateway state database at `~/.local/share/opencode-gateway/state.db`
- remove the OpenCode plugin cache at `~/.cache/opencode/node_modules/opencode-gateway`

After that, run `bunx opencode-gateway@latest init` again if needed, then start
the gateway normally.

## Use Through bunx / npx

Recommended user-facing commands use `bunx` with the latest version:

```bash
bunx opencode-gateway@latest <command>
```

If you prefer npm, replace `bunx` with:

```bash
npx opencode-gateway@latest <command>
```

### 1. Initialize your OpenCode config

Run:

```bash
bunx opencode-gateway@latest init
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
bunx opencode-gateway@latest init --managed
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
# timezone = "Asia/Shanghai"

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
- entry-specific maintenance guidance for `USER.md`, `RULES.md`, and `memory/daily` is injected only when those exact entries are configured
- file contents are auto-injected only when `inject_content = true`
- `search_only = true` keeps an entry available to `memory_search` and `memory_get`
  without auto-injecting its content
- directory entries default to description-only plus on-demand search
- directory `globs` are evaluated relative to the configured directory and define
  which files are auto-injected; other UTF-8 text files remain searchable on demand
- relative paths are resolved from `opencode-gateway-workspace`
- absolute paths are still allowed
- missing files and directories are created automatically on load
- the default workspace scaffold includes `USER.md`, `RULES.md`, `memory/daily/README.md`, and `.opencode/skills/README.md`
- the default template includes `USER.md`, `RULES.md`, and `memory/daily`
- gateway-managed sessions default to workspace-local skills under `opencode-gateway-workspace/.opencode/skills`
- globally configured OpenCode skills remain readable, but new or updated gateway skills should default to the workspace-local skills directory unless the user explicitly asks otherwise
- memory is injected only into gateway-managed sessions, including scheduled
  runs and channel-bound sessions
- `memory_search` returns matching snippets and paths; `memory_get` reads a
  specific configured memory file by path and optional line window

### 3. Verify the generated config

Run:

```bash
bunx opencode-gateway@latest doctor
```

This reports:

- the resolved config directory
- whether `opencode.json` exists
- whether `opencode-gateway.toml` exists
- whether `opencode-gateway` is present in the `plugin` array
- how the Telegram token is configured
- which server origin and workspace directory `bunx opencode-gateway@latest warm` will use

### 4. Start OpenCode

Recommended:

```bash
bunx opencode-gateway@latest serve
```

This wraps `opencode serve` and immediately warms the gateway plugin worker, so
Telegram polling and scheduled jobs start without waiting for a manual
project-scoped request. In managed gateway sessions, the plugin can also use
`gateway_restart` to request an OpenCode restart on the user's behalf when new
skills, agents, or config changes need to take effect.

Once the gateway is running, the intended operator experience is conversational:
you ask for a restart, inspect schedules, switch agents, search memory, or
start a fresh session in natural language, and the gateway tools handle the
mechanics behind the scenes.

If you still prefer to run OpenCode directly, warm the gateway explicitly after
startup:

```bash
opencode serve
bunx opencode-gateway@latest warm
```

If you used `--managed`, start through the wrapper with the same flag:

```bash
bunx opencode-gateway@latest serve --managed
```

If you need the raw OpenCode command instead, set the managed config directory
first and then warm the gateway explicitly:

```bash
export OPENCODE_CONFIG="$HOME/.config/opencode-gateway/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$HOME/.config/opencode-gateway/opencode"
opencode serve
bunx opencode-gateway@latest warm --managed
```

If Telegram is enabled, either set `channels.telegram.bot_token` directly or
export the token through the configured environment variable:

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
