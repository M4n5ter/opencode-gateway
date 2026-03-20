# Opencode Gateway

Rust-first infrastructure for building an OpenClaw-style automation gateway on top of
[OpenCode](https://github.com/anomalyco/opencode), with
[BoltFFI](https://github.com/boltffi/boltffi) generating TypeScript bindings so the
runtime can live inside an OpenCode plugin while the product logic stays in Rust.

This file is the canonical repository guide for both humans and coding agents working
inside this repo.

This repository is intentionally being built in layers:

1. Write the product contract down in one place.
2. Scaffold the workspace so the architecture is visible from the filesystem.
3. Keep the Rust core `wasm-safe` and move host-specific I/O into the Bun/OpenCode side.
4. Add real integrations only after the module boundaries are stable.

The current state of the repository is **contract-first scaffold plus the first real
binding/runtime integration slices**: the workspace, crate/package boundaries,
launcher bootstrap, pure Rust domain model, host orchestration contracts, the first
BoltFFI export facade, callback-capable binding handles, and an OpenCode plugin with
debug-oriented gateway tools are in place. SQLite-backed session persistence and
runtime journaling now exist inside the plugin host, Telegram long polling is wired
through the plugin with explicit allowlists and persistent update cursors, and the
first recurring cron slice is now in place with a persisted job catalog, run history,
background tick loop, and Telegram-capable cron delivery. Richer durable gateway data
models and end-to-end smoke coverage are still to be implemented.

## Vision

The target product is an OpenCode-powered gateway that can:

- react to inbound IM messages,
- trigger agent workflows on schedules,
- keep long-lived per-channel context,
- send results back to users through messaging platforms,
- and stay extensible enough to add new IM platforms without rewriting the core.

The first supported surfaces are:

- scheduled automation (`cron`-like jobs),
- Telegram as the first two-way IM channel,
- OpenCode as the execution substrate,
- and a local single-user deployment model.

## Why This Architecture

OpenCode plugins are written in JavaScript/TypeScript and run inside the Bun-hosted
OpenCode runtime. BoltFFI can generate TypeScript bindings for a Rust library by
packaging it as WebAssembly. That gives us a powerful constraint:

- Rust is excellent for domain modeling, validation, scheduling rules, and long-term
  maintainability.
- Bun/TypeScript is the right place for OpenCode plugin hooks, SQLite access, Telegram
  HTTP polling, and process lifecycle.
- The Rust core therefore must not own native filesystem, socket, or database I/O.
- Instead, the host runtime provides those capabilities back into Rust through callback
  interfaces exposed over BoltFFI.

This split is the main design choice in the repo:

- **Rust owns product rules**
- **TypeScript owns host integration**

That lets us keep the critical logic in Rust without fighting the WebAssembly runtime
model.

## Scope for v1

### In scope

- single-user, single-gateway deployment
- launcher CLI for init / serve / doctor
- OpenCode plugin runtime package
- Telegram long-polling bot for text messages
- per-chat persistent session binding
- SQLite state store
- scheduled jobs with persistent run history
- custom OpenCode tools for gateway operations

### Explicitly out of scope

- multi-tenant or team-shared gateway semantics
- standalone web control panel
- webhook deployment for Telegram
- rich media, buttons, and advanced Telegram bot UX
- multiple IM providers in the first implementation
- production-grade remote orchestration

## Repository Layout

```text
.
├── Cargo.toml
├── package.json
├── AGENTS.md
├── crates
│   ├── core
│   ├── ffi
│   └── launcher
└── packages
    └── opencode-plugin
```

### `crates/core`

Pure Rust domain logic. This crate already contains the first stable product contract:

- channel and conversation identifiers,
- inbound/outbound message shapes,
- scheduling validation,
- prompt planning,
- validation logic,
- and the pure gateway planning surface.

This crate must remain:

- platform-neutral,
- `wasm-safe`,
- free of direct database and network dependencies,
- and independently unit-testable.

### `crates/ffi`

The Rust-to-TypeScript bridge crate.

This crate currently:

- defines host callback traits for store / transport / logging / OpenCode execution,
- provides the Rust-side runtime orchestration layer,
- exposes host-facing result and error types,
- and acts as the only place where FFI-specific compromises are allowed.

This crate now also contains:

- the first BoltFFI-facing export surface,
- binding-friendly callback traits and runtime data types,
- a long-lived exported `GatewayBinding` handle,
- and adapter layers that translate TypeScript callbacks into the internal host
  runtime contracts.

BoltFFI is currently invoked from the repository root using the root `boltffi.toml`.
The repository keeps a root `src -> crates/ffi/src` symlink so BoltFFI can discover
the export crate correctly, and the workspace excludes
`target/boltffi_bindgen_type_resolution` to avoid workspace contamination during
BoltFFI type-resolution runs.

The design rule is simple: if a concern is about business logic, it belongs in
`core`; if it is about crossing the language boundary, it belongs in `ffi`.

### `crates/launcher`

The native Rust CLI for local lifecycle management.

Its job is deliberately narrow:

- initialize managed config,
- start OpenCode with the plugin wired in,
- run environment diagnostics,
- and remain optional for advanced users who prefer to manage OpenCode manually.

The launcher is not the gateway engine itself. It is an operational convenience layer.

### `packages/opencode-plugin`

The Bun/OpenCode host package.

This package now:

- loads the BoltFFI-generated binding,
- constructs a long-lived `GatewayBinding` instance with host callbacks,
- exposes `gateway_status`, `gateway_dispatch_cron`, and the first cron management
  tools through OpenCode,
- parses the gateway config to locate the managed SQLite database,
- persists logical conversation to `OpenCode` session bindings in SQLite,
- records a minimal runtime journal in SQLite,
- persists the Telegram long-poll cursor in SQLite,
- persists recurring cron jobs and cron run history in SQLite,
- implements a real OpenCode session adapter that reuses persisted session bindings,
- runs a cron tick worker backed by persisted next-run timestamps,
- runs a Telegram long-poll worker with explicit chat/user allowlists,
- normalizes Telegram text messages into Rust inbound gateway messages,
- delivers Telegram replies through a real transport host,
- delivers cron results to Telegram when a job has a delivery target,
- and serves as the host-side entrypoint for later storage, transport, and durable
  runtime wiring.

This package will later also:

- add richer control-plane tools for Telegram operations,
- promote audit/journal data into richer durable gateway tables where useful,
- and add end-to-end smoke coverage against a local `OpenCode` server.

## Runtime Model

The intended runtime looks like this:

```text
opencode-gateway serve
  -> prepares managed OpenCode config
  -> starts `opencode serve`
  -> OpenCode loads the local plugin
  -> plugin loads BoltFFI-generated Rust binding
  -> plugin creates host adapters
  -> Rust engine runs inside the plugin process
  -> Telegram updates and cron ticks are forwarded into Rust
  -> Rust decides what should happen
  -> host executes OpenCode sessions and sends outbound messages
```

## Ownership Boundaries

### Rust owns

- canonical types and identifiers
- validation and invariants
- scheduling semantics
- session routing rules
- run state transitions
- provider-agnostic gateway behavior

### TypeScript/Bun owns

- OpenCode plugin entrypoints
- OpenCode SDK calls
- SQLite reads and writes
- Telegram network transport
- timers and polling loops
- local process environment and config path resolution

### Launcher owns

- managed config/bootstrap
- process startup ergonomics
- local diagnostics

## Planned Public Surfaces

### CLI

The launcher crate exposes:

```text
opencode-gateway init
opencode-gateway serve
opencode-gateway doctor
```

The scaffold already implements these commands at a bootstrap level:

- `init` creates the managed gateway/OpenCode directory layout
- `serve` prepares the managed OpenCode config and forwards execution to
  `opencode serve`
- `doctor` checks the presence of `opencode`, `bun`, and the generated files

### OpenCode tools

The plugin package is planned to expose custom tools such as:

- `gateway_status`
- `gateway_dispatch_cron`
- `cron_list`
- `cron_upsert`
- `cron_remove`
- `cron_run`
- `telegram_status`
- `telegram_send_test`

These tools are meant to be the operational control plane inside OpenCode itself.

### Rust FFI facade

The FFI crate currently exports runtime-facing concepts such as:

- `GatewayRuntime`
- `RuntimeReport`
- `RuntimeError`
- `GatewayBinding`
- `GatewayStatus`
- `ConversationKey`
- `CronJobSpec`
- host callback contracts for store / transport / OpenCode execution / logging

## Configuration Model

The first implementation will use a dedicated project config file instead of trying to
encode gateway-specific behavior directly into `opencode.json`.

Planned default locations:

- gateway config: `~/.config/opencode-gateway/config.toml`
- managed OpenCode config directory: `~/.config/opencode-gateway/opencode/`
- SQLite state: `~/.local/share/opencode-gateway/state.db`

The launcher will be responsible for:

- creating the managed OpenCode config directory,
- injecting `OPENCODE_CONFIG`,
- injecting `OPENCODE_CONFIG_DIR`,
- and keeping user-global OpenCode configuration untouched.

Manual OpenCode startup should still be possible by pointing OpenCode at the same
managed config and plugin directory.

## Session Model

The session model for v1 is intentionally conservative:

- each Telegram chat target maps to one persistent logical conversation,
- each logical conversation maps to one OpenCode session ID,
- session bindings are stored in SQLite,
- cron jobs get their own persistent logical session key,
- and no global shared “main” session is introduced in v1.

This avoids context bleeding while preserving long-lived memory per channel.

## Data Model Direction

The host SQLite layer is expected to evolve around a small set of durable concepts:

- `channel_accounts`
- `conversation_routes`
- `session_bindings`
- `cron_jobs`
- `cron_runs`
- `kv_state`

Even though only Telegram is planned initially, these tables are being shaped around a
generic `channel/account/target` model so new IM providers can fit later without
rewriting the core semantics.

The current cron implementation interprets recurring cron expressions in `UTC` only.
Per-job or host-local timezone configuration has not been added yet.

## Development Rules

This repo follows a few non-negotiable engineering rules:

- Rust code targets Edition 2024.
- The Rust core should prefer plain, explicit domain models over hidden framework magic.
- Cross-language boundaries should stay narrow and typed.
- Host-specific logic must not leak into the core crate.
- The first implementation should optimize for correctness and maintainability, not for
  feature count.

## What Exists Today

The current scaffold already establishes:

- a Cargo workspace,
- a Bun workspace root,
- dedicated crates for core / FFI / launcher,
- a plugin package directory,
- split core modules for channel / conversation / message / cron / engine / status,
- split FFI modules for host traits and runtime orchestration,
- a BoltFFI-exported `GatewayBinding` handle with callback-capable host traits,
- plugin-side binding loading plus one status tool, one cron-dispatch debug tool, and
  the first persisted cron control-plane tools,
- SQLite-backed session bindings and runtime journaling inside the plugin host,
- SQLite-backed Telegram update offsets,
- SQLite-backed cron job catalogs and cron run history,
- cron next-run calculation exported from Rust through BoltFFI,
- a plugin-local cron scheduler with skip-missed semantics and bounded concurrency,
- Telegram long polling with explicit allowlists and text-message routing,
- Telegram transport-backed replies driven by Rust runtime plans,
- cron-triggered `OpenCode` execution with optional Telegram delivery,
- and a launcher that can materialize managed config files for local development.

The scaffold does **not** yet include:

- richer durable gateway tables beyond the current minimal catalog/run-history split,
- dedicated Telegram operational tools such as status/send-test,
- or end-to-end smoke coverage against a local `OpenCode` server.

Those will be added incrementally on top of the structure introduced here.

## Next Implementation Steps

The next implementation passes should happen in this order:

1. Promote runtime journaling into richer durable gateway tables where needed.
2. Add Telegram-facing operational tools such as status and send-test where useful.
3. Add richer cron-facing inspection or operational tools only when the current catalog
   and run history stop being sufficient.
4. Add end-to-end smoke tests against a local OpenCode server.

## References

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode plugin docs: <https://opencode.ai/docs/plugins>
- OpenCode custom tool docs: <https://opencode.ai/docs/custom-tools>
- OpenCode SDK docs: <https://opencode.ai/docs/sdk>
- OpenCode config docs: <https://opencode.ai/docs/config>
- BoltFFI repository: <https://github.com/boltffi/boltffi>
- BoltFFI docs: <https://boltffi.dev/docs/getting-started>
- OpenClaw docs: <https://docs.openclaw.ai/>
