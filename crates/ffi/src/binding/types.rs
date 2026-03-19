//! FFI-friendly data types shared by binding exports and callback traits.

use boltffi::data;
use opencode_gateway_core::{
    CronJobSpec, DeliveryTarget, GatewayStatus, InboundMessage, OutboundMessage, PromptRequest,
};

use crate::RuntimeReport;

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
pub struct BindingCronJobSpec {
    pub id: String,
    pub schedule: String,
    pub prompt: String,
}

impl TryFrom<BindingCronJobSpec> for CronJobSpec {
    type Error = String;

    fn try_from(value: BindingCronJobSpec) -> Result<Self, Self::Error> {
        CronJobSpec::new(value.id, value.schedule, value.prompt).map_err(|error| error.to_string())
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

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingPromptRequest {
    pub conversation_key: String,
    pub prompt: String,
}

impl From<&PromptRequest> for BindingPromptRequest {
    fn from(value: &PromptRequest) -> Self {
        Self {
            conversation_key: value.conversation_key.as_str().to_owned(),
            prompt: value.prompt.clone(),
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
