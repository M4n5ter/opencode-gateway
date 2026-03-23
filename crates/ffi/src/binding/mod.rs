//! Wasm-facing gateway export surface.

mod driver;
mod execution;
mod export;
mod types;

pub use driver::OpencodeExecutionDriver;
pub use execution::{prepare_cron_execution, prepare_inbound_execution};
pub use export::{
    conversation_key_for_delivery_target, gateway_status, next_cron_run_at,
    normalize_cron_time_zone,
};
pub use types::{
    BindingCronJobSpec, BindingDeliveryTarget, BindingExecutionObservation, BindingGatewayStatus,
    BindingInboundAttachment, BindingInboundMessage, BindingOpencodeCommand,
    BindingOpencodeCommandPart, BindingOpencodeCommandResult, BindingOpencodeDriverStep,
    BindingOpencodeExecutionInput, BindingOpencodeMessage, BindingOpencodeMessagePart,
    BindingOpencodePrompt, BindingPreparedExecution, BindingProgressiveDirective,
    BindingPromptPart,
};
