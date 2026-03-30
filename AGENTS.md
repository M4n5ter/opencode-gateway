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
- private-chat editable stream previews with split Preview / Tools tool-call views
- Telegram compaction reactions on the current message after `session.compacted`
- auto-cleaned Telegram permission/question interaction prompts
- workspace-local memory and skills scaffold, including the built-in `markdown-agents` guide
- managed restart support for reloading skills, agents, and config changes
- a launcher that bootstraps, supervises, warms, and can restart a managed OpenCode instance

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
- start and supervise OpenCode with the plugin wired in
- discover the managed OpenCode server endpoint and warm the current project instance so plugin workers start immediately
- consume managed restart requests and restart OpenCode after current work goes idle
- run environment diagnostics

### `packages/opencode-plugin`

The Bun/OpenCode host package.

This package now:

- loads the generated `wasm-bindgen` package
- parses gateway config and opens the managed SQLite database
- scaffolds the managed gateway workspace with default `USER.md`, `RULES.md`, `memory/daily`, workspace-local skills, and the built-in `markdown-agents` guide
- persists OpenCode session bindings, Telegram state, cron jobs, and cron runs
- persists durable mailbox queue entries for gateway-managed ingress
- runs Telegram long polling with explicit allowlists
- runs per-mailbox workers with optional reply batching
- supports explicit mailbox route overrides so multiple gateway targets can share one session
- runs the cron scheduler loop
- translates Rust-emitted OpenCode commands into thin plugin SDK calls
- subscribes to the OpenCode SDK event stream and forwards normalized execution
  observations into Rust-owned execution drivers
- delivers Telegram replies and private-chat editable stream previews
- renders Telegram tool-call details through per-message Preview / Tools view state with paginated tool history
- bridges OpenCode permission/question interactions into Telegram and cleans them up after successful replies
- applies mailbox-scoped inflight policy (`ask`, `queue`, or `interrupt`) when new ingress arrives during an active run
- exposes gateway, schedule, memory, channel, agent, and Telegram operational tools

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
  -> new ingress that arrives during an active mailbox run is held or interrupt-routed by policy
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
- Telegram HTTP transport, editable streams, split preview/tool callbacks, compaction reactions, and interaction cleanup
- polling loops and timers
- local environment, workspace scaffold, and config path resolution

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
opencode-gateway warm
```

### OpenCode tools

- `agent_status`
- `agent_switch`
- `channel_new_session`
- `channel_send_file`
- `cron_run`
- `cron_upsert`
- `gateway_dispatch_cron`
- `gateway_restart`
- `gateway_status`
- `memory_get`
- `memory_search`
- `schedule_cancel`
- `schedule_list`
- `schedule_once`
- `schedule_status`
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

- default OpenCode config: `~/.config/opencode/opencode.jsonc` when absent, otherwise existing `opencode.jsonc` or `opencode.json`
- default gateway config: `~/.config/opencode/opencode-gateway.toml`
- managed OpenCode config directory: `~/.config/opencode-gateway/opencode/`
- managed gateway config: `~/.config/opencode-gateway/opencode/opencode-gateway.toml`
- SQLite state: `~/.local/share/opencode-gateway/state.db`

The launcher is responsible for creating and wiring these managed paths without
touching the user's global OpenCode config.

Gateway-managed sessions run against the managed workspace rooted at
`opencode-gateway-workspace/`. The workspace scaffold includes:

- `USER.md`
- `RULES.md`
- `memory/daily/README.md`
- `.opencode/skills/README.md`
- `.opencode/skills/markdown-agents/`

The gateway injects stronger maintenance guidance for `USER.md`, `RULES.md`, and
`memory/daily` only when those specific entries are present in `memory.entries`.
Gateway-managed sessions may still read globally configured OpenCode skills, but
new or updated gateway skills should default to the workspace-local
`.opencode/skills/` directory unless the user explicitly asks for a global change.

## Session Model

The session model for v1 is intentionally conservative:

- each Telegram chat target maps to one persistent logical conversation
- each logical conversation maps to one OpenCode session ID
- session bindings are stored in SQLite
- cron jobs get their own persistent logical session key

## Data Model Direction

The SQLite layer currently revolves around:

- `mailbox_entries`
- `mailbox_jobs`
- `mailbox_deliveries`
- `session_bindings`
- `session_reply_targets`
- `pending_interactions`
- `telegram_message_cleanup_jobs`
- `telegram_preview_messages`
- `telegram_session_compactions`
- `telegram_session_surfaces`
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
- a launcher that can materialize managed config, supervise a managed OpenCode process, warm the current project, and honor managed restart requests
- a plugin package with Telegram, SQLite, and cron behavior
- plugin-local host orchestration for mailbox workers and cron dispatch
- durable mailbox queueing for gateway-managed ingress
- optional mailbox reply batching behind a config flag
- mailbox-scoped inflight message policy with `ask` / `queue` / `interrupt`
- explicit mailbox route overrides for shared-session ingress
- SQLite-backed session bindings and runtime journaling
- SQLite-backed pending interactions and delayed Telegram cleanup jobs
- SQLite-backed Telegram health snapshots and update cursors
- SQLite-backed cron catalogs and run history
- Telegram long polling with allowlists
- Telegram operational tools
- schedule tools for recurring jobs and one-shot follow-ups
- gateway restart support for applying skill, agent, and config changes
- memory search and retrieval tools for configured workspace memory
- route-aware agent inspection and switching tools
- private-chat editable stream previews with split Preview / Tools tool-call details
- paginated tool-call history inside the Telegram `Tools` view
- compaction reactions that mark the current Telegram message after `session.compacted`
- permission/question bridging with post-reply cleanup
- mailbox-scoped inflight interactions that can queue or interrupt an active run
- a local OpenCode smoke script

## Next Implementation Steps

The next implementation passes should happen in this order:

1. Refine Telegram progressive-reply UX only where the current split Preview / Tools model still feels noisy.
2. Revisit whether inflight queue/interrupt interactions need richer user-visible status after an interrupt or revert failure.
3. Add richer durable gateway tables only where the current catalog/journal split
   becomes limiting.
4. Revisit how much async execution logic should move back into Rust only if a stable,
   low-complexity boundary appears.
5. Add richer operational inspection only when the current tool surface stops being
   sufficient.

## References

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode plugin docs: <https://opencode.ai/docs/plugins>
- OpenCode SDK docs: <https://opencode.ai/docs/sdk>
- OpenCode config docs: <https://opencode.ai/docs/config>
- wasm-bindgen guide: <https://wasm-bindgen.github.io/wasm-bindgen/>
- OpenClaw docs: <https://docs.openclaw.ai/>
