//! Host-facing runtime contracts for the opencode gateway.

pub mod binding;
pub mod host;
pub mod runtime;

pub use binding::{
    BindingCronJobSpec, BindingGatewayStatus, BindingRuntimeReport, dispatch_cron_job,
    gateway_status,
};
pub use host::{
    HostClock, HostFailure, HostLogger, HostOpencode, HostResult, HostStore, HostSubsystem,
    HostTransport, LogLevel,
};
pub use runtime::{GatewayRuntime, RuntimeError, RuntimeReport, RuntimeResult};
