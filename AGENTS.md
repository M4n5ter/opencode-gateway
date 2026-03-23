# Opencode Gateway

Rust-first infrastructure for building an OpenClaw-style automation gateway on top of
[OpenCode](https://github.com/anomalyco/opencode).

This file is the canonical repository guide for both humans and coding agents working
inside this repo.

## Current Architecture

The repository now uses a **Rust core + TypeScript host + `wasm-bindgen` sync bridge**
split:

- Rust owns typed contracts, validation, cron semantics, progressive text state,
  and the OpenCode execution state machine.
- TypeScript owns OpenCode plugin hooks, thin SDK command translation, SQLite,
  Telegram I/O, and the async host loops.
- The WebAssembly boundary is intentionally small and synchronous.

The current state of the repository is a working local gateway with:

- SQLite-backed session persistence
- Telegram long polling with explicit allowlists
- recurring cron jobs with a persisted catalog and run history
- Telegram operational tools
- private-chat draft preview support
- a launcher that bootstraps and warms a managed OpenCode instance

## Repository Layout

```text
.
├── Cargo.toml
├── package.json
├── README.md
├── AGENTS.md
├── crates
│   ├── core
│   ├── ffi
│   ├── launcher
│   └── runtime
└── packages
    └── opencode-plugin
```

### `crates/core`

Pure Rust domain logic.

This crate owns:

- channel and conversation identifiers
- inbound/outbound message shapes
- cron validation and next-run calculation
- progressive text delivery state
- pure gateway planning types

This crate must remain:

- platform-neutral
- `wasm-safe`
- free of direct database and network dependencies
- independently unit-testable

### `crates/ffi`

The Rust-to-JavaScript bridge crate.

This crate now exports only a small synchronous `wasm-bindgen` surface:

- `gatewayStatus()`
- `nextCronRunAt(...)`
- `prepareInboundExecution(...)`
- `prepareCronExecution(...)`
- `OpencodeExecutionDriver`

It no longer carries the old callback-heavy FFI runtime.

### `crates/runtime`

Rust-owned OpenCode execution driver state.

This crate owns:

- host command sequencing for OpenCode session execution
- deterministic prompt/message identity derivation
- stale session retry policy
- assistant-message binding and text-part aggregation during execution

### `crates/launcher`

The native Rust CLI for local lifecycle management.

Its job is deliberately narrow:

- initialize managed config
- start OpenCode with the plugin wired in
- warm the current project instance so plugin workers start immediately
- run environment diagnostics

### `packages/opencode-plugin`

The Bun/OpenCode host package.

This package now:

- loads the generated `wasm-bindgen` package
- parses gateway config and opens the managed SQLite database
- persists OpenCode session bindings, Telegram state, cron jobs, and cron runs
- persists durable mailbox queue entries for gateway-managed ingress
- runs Telegram long polling with explicit allowlists
- runs per-mailbox workers with optional reply batching
- supports explicit mailbox route overrides so multiple gateway targets can share one session
- runs the cron scheduler loop
- translates Rust-emitted OpenCode commands into thin plugin SDK calls
- subscribes to the OpenCode SDK event stream and forwards normalized execution
  observations into Rust-owned execution drivers
- delivers Telegram replies and private-chat draft previews
- exposes gateway, cron, and Telegram operational tools

## Runtime Model

```text
opencode-gateway serve
  -> prepares managed OpenCode config
  -> starts `opencode serve`
  -> warms the current project instance
  -> OpenCode loads the local plugin
  -> plugin loads the generated wasm package
  -> plugin builds host-side services
  -> Telegram updates are enqueued into durable mailboxes
  -> per-mailbox workers serialize ingress and optionally batch replies
  -> cron ticks enter the plugin-local executor directly
  -> Rust emits OpenCode host commands one step at a time
  -> plugin executes those commands through the SDK and outbound delivery
  -> Rust remains responsible for typed contracts, prepared executions,
     execution sequencing, event aggregation, cron next-run calculation,
     and progressive delivery state
```

## Ownership Boundaries

### Rust owns

- canonical types and identifiers
- validation and invariants
- scheduling semantics
- prepared inbound/cron execution plans
- OpenCode execution sequencing and stale-session recovery
- assistant-message binding and text-part aggregation
- progressive text state and flush/finalize decisions
- provider-agnostic gateway behavior

### TypeScript/Bun owns

- OpenCode plugin entrypoints
- thin OpenCode SDK command execution
- event subscription and raw event normalization
- SQLite reads and writes
- Telegram HTTP transport and drafts
- polling loops and timers
- local environment and config path resolution

### Launcher owns

- managed config/bootstrap
- local diagnostics
- process startup ergonomics

## Public Surfaces

### CLI

```text
opencode-gateway init
opencode-gateway serve
opencode-gateway doctor
```

### OpenCode tools

- `gateway_status`
- `gateway_dispatch_cron`
- `cron_list`
- `cron_upsert`
- `cron_remove`
- `cron_run`
- `telegram_status`
- `telegram_send_test`

### Wasm surface

- `gatewayStatus()`
- `nextCronRunAt(job, afterMs)`
- `prepareInboundExecution(message)`
- `prepareCronExecution(job)`
- `new OpencodeExecutionDriver(input)`
- `OpencodeExecutionDriver.start()`
- `OpencodeExecutionDriver.resume(result)`
- `OpencodeExecutionDriver.observeEvent(observation, nowMs)`

## Configuration Model

Default paths:

- default OpenCode config: `~/.config/opencode/opencode.json`
- default gateway config: `~/.config/opencode/opencode-gateway.toml`
- managed OpenCode config directory: `~/.config/opencode-gateway/opencode/`
- managed gateway config: `~/.config/opencode-gateway/opencode/opencode-gateway.toml`
- SQLite state: `~/.local/share/opencode-gateway/state.db`

The launcher is responsible for creating and wiring these managed paths without
touching the user's global OpenCode config.

## Session Model

The session model for v1 is intentionally conservative:

- each Telegram chat target maps to one persistent logical conversation
- each logical conversation maps to one OpenCode session ID
- session bindings are stored in SQLite
- cron jobs get their own persistent logical session key

## Data Model Direction

The SQLite layer currently revolves around:

- `mailbox_entries`
- `session_bindings`
- `runtime_journal`
- `cron_jobs`
- `cron_runs`
- `kv_state`

The current cron implementation interprets recurring cron expressions in the effective
cron time zone, using `cron.timezone` when configured and otherwise the runtime's
local time zone.

## What Exists Today

The repository already contains:

- a Cargo workspace and Bun workspace root
- a pure Rust core crate with typed contracts and progressive state
- a Rust runtime crate with an OpenCode execution driver
- a sync `wasm-bindgen` bridge crate
- Rust-owned prepared execution, driver sequencing, and event aggregation state
- a launcher that can materialize managed config and warm the current project
- a plugin package with Telegram, SQLite, and cron behavior
- plugin-local host orchestration for mailbox workers and cron dispatch
- durable mailbox queueing for gateway-managed ingress
- optional mailbox reply batching behind a config flag
- explicit mailbox route overrides for shared-session ingress
- SQLite-backed session bindings and runtime journaling
- SQLite-backed Telegram health snapshots and update cursors
- SQLite-backed cron catalogs and run history
- Telegram long polling with allowlists
- Telegram operational tools
- private-chat draft preview support
- a local OpenCode smoke script

## Next Implementation Steps

The next implementation passes should happen in this order:

1. Finish validating Telegram draft preview behavior end-to-end.
2. Add richer durable gateway tables only where the current catalog/journal split
   becomes limiting.
3. Revisit how much async execution logic should move back into Rust only if a stable,
   low-complexity boundary appears.
4. Add richer operational inspection only when the current tool surface stops being
   sufficient.

## References

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode plugin docs: <https://opencode.ai/docs/plugins>
- OpenCode SDK docs: <https://opencode.ai/docs/sdk>
- OpenCode config docs: <https://opencode.ai/docs/config>
- wasm-bindgen guide: <https://wasm-bindgen.github.io/wasm-bindgen/>
- OpenClaw docs: <https://docs.openclaw.ai/>
