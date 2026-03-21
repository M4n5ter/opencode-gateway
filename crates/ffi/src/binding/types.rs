//! Wasm-facing data types shared by exported functions and handles.

use opencode_gateway_core::{
    ChannelKind, CronJobSpec, DeliveryTarget, ExecutionObservation, ExecutionRole, GatewayStatus,
    PreparedExecution, ProgressiveDirective, TargetKey,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingGatewayStatus {
    pub runtime_mode: String,
    pub supports_telegram: bool,
    pub supports_cron: bool,
    pub has_web_ui: bool,
}

impl From<&GatewayStatus> for BindingGatewayStatus {
    fn from(value: &GatewayStatus) -> Self {
        Self {
            runtime_mode: value.runtime_mode.to_owned(),
            supports_telegram: value.supports_telegram,
            supports_cron: value.supports_cron,
            has_web_ui: value.has_web_ui,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingCronJobSpec {
    pub id: String,
    pub schedule: String,
    pub prompt: String,
    pub delivery_channel: Option<String>,
    pub delivery_target: Option<String>,
    pub delivery_topic: Option<String>,
}

impl TryFrom<BindingCronJobSpec> for CronJobSpec {
    type Error = String;

    fn try_from(value: BindingCronJobSpec) -> Result<Self, Self::Error> {
        let delivery_target = match (
            value.delivery_channel,
            value.delivery_target,
            value.delivery_topic,
        ) {
            (None, None, topic) => {
                if topic
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    return Err(
                        "cron deliveryTopic requires deliveryChannel and deliveryTarget".to_owned(),
                    );
                }
                None
            }
            (Some(channel), Some(target), topic) => Some(
                BindingDeliveryTarget {
                    channel,
                    target,
                    topic,
                }
                .try_into()?,
            ),
            (Some(_), None, _) | (None, Some(_), _) => {
                return Err(
                    "cron deliveryChannel and deliveryTarget must be provided together".to_owned(),
                );
            }
        };

        CronJobSpec::with_delivery_target(value.id, value.schedule, value.prompt, delivery_target)
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingPreparedExecution {
    pub conversation_key: String,
    pub prompt: String,
    pub reply_target: Option<BindingDeliveryTarget>,
}

impl From<PreparedExecution> for BindingPreparedExecution {
    fn from(value: PreparedExecution) -> Self {
        Self {
            conversation_key: value.conversation_key,
            prompt: value.prompt,
            reply_target: value.reply_target.map(BindingDeliveryTarget::from),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingDeliveryTarget {
    pub channel: String,
    pub target: String,
    pub topic: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingInboundMessage {
    pub delivery_target: BindingDeliveryTarget,
    pub sender: String,
    pub body: String,
    pub mailbox_key: Option<String>,
}

impl TryFrom<BindingInboundMessage> for opencode_gateway_core::InboundMessage {
    type Error = String;

    fn try_from(value: BindingInboundMessage) -> Result<Self, Self::Error> {
        let delivery_target: DeliveryTarget = value.delivery_target.try_into()?;
        let sender = parse_required(value.sender, "message sender")?;
        let body = parse_required(value.body, "message body")?;

        let mut message = opencode_gateway_core::InboundMessage::new(
            delivery_target.channel,
            delivery_target.target,
            delivery_target.topic,
            sender,
            body,
        )
        .map_err(|error| error.to_string())?;

        if let Some(mailbox_key) = value.mailbox_key {
            message
                .set_conversation_key_override(mailbox_key)
                .map_err(|error| error.to_string())?;
        }

        Ok(message)
    }
}

impl From<DeliveryTarget> for BindingDeliveryTarget {
    fn from(value: DeliveryTarget) -> Self {
        Self {
            channel: value.channel.as_str().to_owned(),
            target: value.target.as_str().to_owned(),
            topic: value.topic,
        }
    }
}

impl TryFrom<BindingDeliveryTarget> for DeliveryTarget {
    type Error = String;

    fn try_from(value: BindingDeliveryTarget) -> Result<Self, Self::Error> {
        let channel = parse_channel_kind(&value.channel)?;
        let target = TargetKey::new(value.target)
            .ok_or_else(|| "delivery target must not be empty".to_owned())?;

        Ok(DeliveryTarget::new(channel, target, value.topic))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingExecutionObservation {
    MessageUpdated {
        session_id: String,
        message_id: String,
        role: String,
        parent_id: Option<String>,
    },
    TextPartUpdated {
        session_id: String,
        message_id: String,
        part_id: String,
        text: Option<String>,
        delta: Option<String>,
        ignored: bool,
    },
    TextPartDelta {
        message_id: String,
        part_id: String,
        delta: String,
    },
}

impl TryFrom<BindingExecutionObservation> for ExecutionObservation {
    type Error = String;

    fn try_from(value: BindingExecutionObservation) -> Result<Self, Self::Error> {
        match value {
            BindingExecutionObservation::MessageUpdated {
                session_id,
                message_id,
                role,
                parent_id,
            } => Ok(Self::MessageUpdated {
                session_id: parse_required(session_id, "execution sessionId")?,
                message_id: parse_required(message_id, "execution messageId")?,
                role: parse_execution_role(role),
                parent_id: normalize_optional_identifier(parent_id),
            }),
            BindingExecutionObservation::TextPartUpdated {
                session_id,
                message_id,
                part_id,
                text,
                delta,
                ignored,
            } => Ok(Self::TextPartUpdated {
                session_id: parse_required(session_id, "execution sessionId")?,
                message_id: parse_required(message_id, "execution messageId")?,
                part_id: parse_required(part_id, "execution partId")?,
                text,
                delta,
                ignored,
            }),
            BindingExecutionObservation::TextPartDelta {
                message_id,
                part_id,
                delta,
            } => Ok(Self::TextPartDelta {
                message_id: parse_required(message_id, "execution messageId")?,
                part_id: parse_required(part_id, "execution partId")?,
                delta,
            }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingProgressiveDirective {
    pub kind: String,
    pub text: Option<String>,
}

impl BindingProgressiveDirective {
    pub fn noop() -> Self {
        Self {
            kind: "noop".to_owned(),
            text: None,
        }
    }
}

impl From<ProgressiveDirective> for BindingProgressiveDirective {
    fn from(value: ProgressiveDirective) -> Self {
        match value {
            ProgressiveDirective::Noop => Self::noop(),
            ProgressiveDirective::Preview(text) => Self {
                kind: "preview".to_owned(),
                text: Some(text),
            },
            ProgressiveDirective::Final(text) => Self {
                kind: "final".to_owned(),
                text: Some(text),
            },
        }
    }
}

fn parse_channel_kind(value: &str) -> Result<ChannelKind, String> {
    match value.trim() {
        "telegram" => Ok(ChannelKind::Telegram),
        other => Err(format!("unsupported channel kind: {other}")),
    }
}

fn parse_execution_role(value: String) -> ExecutionRole {
    match value.trim() {
        "user" => ExecutionRole::User,
        "assistant" => ExecutionRole::Assistant,
        other => ExecutionRole::Other(other.to_owned()),
    }
}

fn parse_required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed.to_owned())
}

fn normalize_optional_identifier(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::BindingExecutionObservation;

    #[test]
    fn binding_execution_observation_accepts_camel_case_variant_fields() {
        let observation: BindingExecutionObservation = serde_json::from_value(json!({
            "kind": "messageUpdated",
            "sessionId": "ses_1",
            "messageId": "msg_1",
            "role": "assistant",
            "parentId": "msg_user_1",
        }))
        .expect("observation");

        assert!(matches!(
            observation,
            BindingExecutionObservation::MessageUpdated {
                session_id,
                message_id,
                role,
                parent_id,
            } if session_id == "ses_1"
                && message_id == "msg_1"
                && role == "assistant"
                && parent_id.as_deref() == Some("msg_user_1")
        ));
    }

    #[test]
    fn binding_execution_observation_preserves_whitespace_deltas() {
        let observation: BindingExecutionObservation = serde_json::from_value(json!({
            "kind": "textPartDelta",
            "messageId": "msg_1",
            "partId": "part_1",
            "delta": " ",
        }))
        .expect("observation");

        assert!(matches!(
            observation,
            BindingExecutionObservation::TextPartDelta {
                message_id,
                part_id,
                delta,
            } if message_id == "msg_1" && part_id == "part_1" && delta == " "
        ));
    }
}
