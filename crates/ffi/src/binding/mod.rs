//! BoltFFI-facing gateway binding surface.

mod adapters;
mod export;
mod traits;
mod types;

pub use export::GatewayBinding;
pub use traits::{
    BindingClockHost, BindingLoggerHost, BindingOpencodeHost, BindingStoreHost,
    BindingTransportHost,
};
pub use types::{
    BindingCronJobSpec, BindingDeliveryTarget, BindingGatewayStatus, BindingInboundMessage,
    BindingOutboundMessage, BindingPromptRequest, BindingPromptResult, BindingRuntimeReport,
};
