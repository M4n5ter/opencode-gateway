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

The current state of the repository is **contract-first scaffold plus the first
binding-first integration slice**: the workspace, crate/package boundaries, launcher
bootstrap, pure Rust domain model, host orchestration contracts, the first BoltFFI
export facade, and a minimal OpenCode plugin status tool are in place, while the real
Telegram, SQLite, and production host integrations are still to be implemented.

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
- binding-friendly status and runtime report data types,
- and a minimal no-op host setup that proves Rust -> WASM -> TypeScript wiring.

BoltFFI currently needs to be invoked from the crate directory while still using the
repository-level config, so `crates/ffi/boltffi.toml` is a thin pointer to the root
`boltffi.toml` and the workspace scripts run BoltFFI from `crates/ffi`.

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
- exposes a minimal `gateway_status` tool through OpenCode,
- and serves as the host-side entrypoint for later storage, transport, and OpenCode
  runtime wiring.

This package will later also:

- implement host callbacks for storage, transport, logging, and OpenCode session
  execution,
- start the Telegram polling loop,
- start the cron tick loop,
- and translate host events into Rust engine calls.

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
- `GatewayStatus`
- `ConversationKey`
- `CronJobSpec`
- host callback contracts for store / transport / OpenCode execution / logging

It will later grow a BoltFFI export facade on top of these contracts.

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
- and a launcher that can materialize managed config files for local development.

The scaffold does **not** yet include:

- real host callbacks across the Rust/TypeScript boundary,
- SQLite schema or migrations,
- Telegram API handling,
- or actual cron execution logic beyond binding-level smoke behavior.

Those will be added incrementally on top of the structure introduced here.

## Next Implementation Steps

The next implementation passes should happen in this order:

1. Replace the no-op BoltFFI host setup with real callback-capable adapters.
2. Add SQLite-backed host adapters.
3. Add Telegram long polling.
4. Add cron management and execution.
5. Add end-to-end smoke tests against a local OpenCode server.

## References

- OpenCode repository: <https://github.com/anomalyco/opencode>
- OpenCode plugin docs: <https://opencode.ai/docs/plugins>
- OpenCode custom tool docs: <https://opencode.ai/docs/custom-tools>
- OpenCode SDK docs: <https://opencode.ai/docs/sdk>
- OpenCode config docs: <https://opencode.ai/docs/config>
- BoltFFI repository: <https://github.com/boltffi/boltffi>
- BoltFFI docs: <https://boltffi.dev/docs/getting-started>
- OpenClaw docs: <https://docs.openclaw.ai/>
