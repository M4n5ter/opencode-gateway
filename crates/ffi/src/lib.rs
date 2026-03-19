//! Host-facing runtime contracts for the opencode gateway.

pub mod host;
pub mod runtime;

pub use host::{
    HostClock, HostFailure, HostLogger, HostOpencode, HostResult, HostStore, HostSubsystem,
    HostTransport, LogLevel,
};
pub use runtime::{GatewayRuntime, RuntimeError, RuntimeReport, RuntimeResult};
