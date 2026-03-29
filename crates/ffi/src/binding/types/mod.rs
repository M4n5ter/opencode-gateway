//! Wasm-facing data types shared by exported functions and handles.

mod execution;
mod gateway;
mod opencode;

use opencode_gateway_core::{ChannelKind, ExecutionPartKind, ExecutionRole, ProgressiveMode};
use opencode_gateway_runtime::OpencodeCommandErrorCode;

pub use execution::{BindingExecutionObservation, BindingProgressiveDirective};
pub use gateway::{
    BindingCronJobSpec, BindingDeliveryTarget, BindingGatewayStatus, BindingInboundAttachment,
    BindingInboundMessage, BindingPreparedExecution, BindingPromptPart, BindingReplyContext,
    BindingReplyContextAttachment,
};
pub use opencode::{
    BindingOpencodeCommand, BindingOpencodeCommandPart, BindingOpencodeCommandResult,
    BindingOpencodeDriverStep, BindingOpencodeExecutionInput, BindingOpencodeMessage,
    BindingOpencodeMessagePart, BindingOpencodePrompt,
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

pub(crate) fn parse_execution_part_kind(value: String) -> Result<ExecutionPartKind, String> {
    match value.trim() {
        "text" => Ok(ExecutionPartKind::Text),
        "reasoning" => Ok(ExecutionPartKind::Reasoning),
        other => Err(format!("unsupported execution part kind: {other}")),
    }
}

pub(crate) fn parse_command_error_code(value: &str) -> Result<OpencodeCommandErrorCode, String> {
    match value.trim() {
        "missingSession" => Ok(OpencodeCommandErrorCode::MissingSession),
        "timeout" => Ok(OpencodeCommandErrorCode::Timeout),
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

#[cfg(test)]
mod tests {
    use super::parse_command_error_code;
    use opencode_gateway_runtime::OpencodeCommandErrorCode;

    #[test]
    fn parse_timeout_command_error_code() {
        assert_eq!(
            parse_command_error_code("timeout").expect("timeout should parse"),
            OpencodeCommandErrorCode::Timeout
        );
    }
}
