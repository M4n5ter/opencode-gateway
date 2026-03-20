//! FFI-friendly data types shared by binding exports and callback traits.

use boltffi::data;
use opencode_gateway_core::{
    ChannelKind, CronJobSpec, DeliveryTarget, GatewayStatus, InboundMessage, OutboundMessage,
    PromptRequest, TargetKey,
};

use crate::{OpencodePromptResult, RuntimeReport};

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
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

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingHostAck {
    pub error_message: Option<String>,
}

impl BindingHostAck {
    pub fn ok() -> Self {
        Self {
            error_message: None,
        }
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            error_message: Some(message.into()),
        }
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingSessionBinding {
    pub session_id: Option<String>,
    pub error_message: Option<String>,
}

impl BindingSessionBinding {
    pub fn ok(session_id: Option<String>) -> Self {
        Self {
            session_id,
            error_message: None,
        }
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            session_id: None,
            error_message: Some(message.into()),
        }
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingCronJobSpec {
    pub id: String,
    pub schedule: String,
    pub prompt: String,
    pub delivery_channel: Option<String>,
    pub delivery_target: Option<String>,
    pub delivery_topic: Option<String>,
}

impl From<&CronJobSpec> for BindingCronJobSpec {
    fn from(value: &CronJobSpec) -> Self {
        let (delivery_channel, delivery_target, delivery_topic) = match &value.delivery_target {
            Some(target) => (
                Some(target.channel.as_str().to_owned()),
                Some(target.target.as_str().to_owned()),
                target.topic.clone(),
            ),
            None => (None, None, None),
        };

        Self {
            id: value.id.as_str().to_owned(),
            schedule: value.schedule.clone(),
            prompt: value.prompt.clone(),
            delivery_channel,
            delivery_target,
            delivery_topic,
        }
    }
}

impl TryFrom<BindingCronJobSpec> for CronJobSpec {
    type Error = String;

    fn try_from(value: BindingCronJobSpec) -> Result<Self, Self::Error> {
        let delivery_target = match (value.delivery_channel, value.delivery_target, value.delivery_topic) {
            (None, None, topic) => {
                if topic.as_deref().is_some_and(|value| !value.trim().is_empty()) {
                    return Err(
                        "cron delivery_topic requires delivery_channel and delivery_target".to_owned(),
                    );
                }
                None
            }
            (Some(channel), Some(target), topic) => Some(BindingDeliveryTarget {
                channel,
                target,
                topic,
            }
            .try_into()?),
            (Some(_), None, _) | (None, Some(_), _) => {
                return Err(
                    "cron delivery_channel and delivery_target must be provided together".to_owned(),
                )
            }
        };

        CronJobSpec::with_delivery_target(value.id, value.schedule, value.prompt, delivery_target)
            .map_err(|error| error.to_string())
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingDeliveryTarget {
    pub channel: String,
    pub target: String,
    pub topic: Option<String>,
}

impl From<&DeliveryTarget> for BindingDeliveryTarget {
    fn from(value: &DeliveryTarget) -> Self {
        Self {
            channel: value.channel.as_str().to_owned(),
            target: value.target.as_str().to_owned(),
            topic: value.topic.clone(),
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

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingInboundMessage {
    pub delivery_target: BindingDeliveryTarget,
    pub sender: String,
    pub body: String,
}

impl From<&InboundMessage> for BindingInboundMessage {
    fn from(value: &InboundMessage) -> Self {
        Self {
            delivery_target: BindingDeliveryTarget::from(&value.delivery_target),
            sender: value.sender.clone(),
            body: value.body.clone(),
        }
    }
}

impl TryFrom<BindingInboundMessage> for InboundMessage {
    type Error = String;

    fn try_from(value: BindingInboundMessage) -> Result<Self, Self::Error> {
        let delivery_target = value.delivery_target;
        let channel = parse_channel_kind(&delivery_target.channel)?;
        let target = TargetKey::new(delivery_target.target)
            .ok_or_else(|| "delivery target must not be empty".to_owned())?;

        InboundMessage::new(
            channel,
            target,
            delivery_target.topic,
            value.sender,
            value.body,
        )
        .map_err(|error| error.to_string())
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingPromptRequest {
    pub conversation_key: String,
    pub prompt: String,
    pub session_id: Option<String>,
}

impl BindingPromptRequest {
    pub fn from_request_and_session(value: &PromptRequest, session_id: Option<String>) -> Self {
        Self {
            conversation_key: value.conversation_key.as_str().to_owned(),
            prompt: value.prompt.clone(),
            session_id,
        }
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingPromptResult {
    pub session_id: Option<String>,
    pub response_text: String,
    pub error_message: Option<String>,
}

impl From<OpencodePromptResult> for BindingPromptResult {
    fn from(value: OpencodePromptResult) -> Self {
        Self {
            session_id: Some(value.session_id),
            response_text: value.response_text,
            error_message: None,
        }
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingOutboundMessage {
    pub delivery_target: BindingDeliveryTarget,
    pub body: String,
}

impl From<&OutboundMessage> for BindingOutboundMessage {
    fn from(value: &OutboundMessage) -> Self {
        Self {
            delivery_target: BindingDeliveryTarget::from(&value.delivery_target),
            body: value.body.clone(),
        }
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingRuntimeReport {
    pub conversation_key: String,
    pub response_text: String,
    pub delivered: bool,
    pub recorded_at_ms: u64,
}

impl From<RuntimeReport> for BindingRuntimeReport {
    fn from(value: RuntimeReport) -> Self {
        Self {
            conversation_key: value.conversation_key.as_str().to_owned(),
            response_text: value.response_text,
            delivered: value.delivered,
            recorded_at_ms: value.recorded_at_ms,
        }
    }
}

fn parse_channel_kind(value: &str) -> Result<ChannelKind, String> {
    match value.trim() {
        "telegram" => Ok(ChannelKind::Telegram),
        other => Err(format!("unsupported channel kind: {other}")),
    }
}
