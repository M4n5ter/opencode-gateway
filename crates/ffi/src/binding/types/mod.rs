//! Wasm-facing data types shared by exported functions and handles.

mod execution;
mod gateway;
mod opencode;

use opencode_gateway_core::{ChannelKind, ExecutionRole, ProgressiveMode};
use opencode_gateway_runtime::OpencodeCommandErrorCode;

pub use execution::{BindingExecutionObservation, BindingProgressiveDirective};
pub use gateway::{
    BindingCronJobSpec, BindingDeliveryTarget, BindingGatewayStatus, BindingInboundMessage,
    BindingPreparedExecution,
};
pub use opencode::{
    BindingOpencodeCommand, BindingOpencodeCommandResult, BindingOpencodeDriverStep,
    BindingOpencodeExecutionInput, BindingOpencodeMessage, BindingOpencodeMessagePart,
    BindingOpencodePrompt,
};

pub(crate) fn parse_channel_kind(value: &str) -> Result<ChannelKind, String> {
    match value.trim() {
        "telegram" => Ok(ChannelKind::Telegram),
        other => Err(format!("unsupported channel kind: {other}")),
    }
}

pub(crate) fn parse_execution_role(value: String) -> ExecutionRole {
    match value.trim() {
        "user" => ExecutionRole::User,
        "assistant" => ExecutionRole::Assistant,
        other => ExecutionRole::Other(other.to_owned()),
    }
}

pub(crate) fn parse_progressive_mode(value: &str) -> Result<ProgressiveMode, String> {
    match value.trim() {
        "progressive" => Ok(ProgressiveMode::Progressive),
        "oneshot" => Ok(ProgressiveMode::Oneshot),
        other => Err(format!("unsupported progressive mode: {other}")),
    }
}

pub(crate) fn parse_command_error_code(value: &str) -> Result<OpencodeCommandErrorCode, String> {
    match value.trim() {
        "missingSession" => Ok(OpencodeCommandErrorCode::MissingSession),
        "unknown" => Ok(OpencodeCommandErrorCode::Unknown),
        other => Err(format!("unsupported command error code: {other}")),
    }
}

pub(crate) fn parse_required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed.to_owned())
}

pub(crate) fn normalize_optional_identifier(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}
