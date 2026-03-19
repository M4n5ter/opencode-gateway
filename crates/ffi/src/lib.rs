//! Host-facing runtime contracts for the opencode gateway.

pub mod binding;
pub mod host;
pub mod runtime;

pub use binding::{
    BindingClockHost, BindingCronJobSpec, BindingDeliveryTarget, BindingGatewayStatus,
    BindingInboundMessage, BindingLoggerHost, BindingOpencodeHost, BindingOutboundMessage,
    BindingPromptRequest, BindingPromptResult, BindingRuntimeReport, BindingStoreHost,
    BindingTransportHost, GatewayBinding,
};
pub use host::{
    HostClock, HostFailure, HostLogger, HostOpencode, HostResult, HostStore, HostSubsystem,
    HostTransport, LogLevel, OpencodePromptRequest, OpencodePromptResult,
};
pub use runtime::{GatewayRuntime, RuntimeError, RuntimeReport, RuntimeResult};
