//! Wasm-facing data types shared by exported functions and handles.

use opencode_gateway_core::{ChannelKind, CronJobSpec, DeliveryTarget, GatewayStatus, ProgressiveDirective, TargetKey};
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
        let delivery_target = match (value.delivery_channel, value.delivery_target, value.delivery_topic) {
            (None, None, topic) => {
                if topic.as_deref().is_some_and(|value| !value.trim().is_empty()) {
                    return Err(
                        "cron deliveryTopic requires deliveryChannel and deliveryTarget".to_owned(),
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
                    "cron deliveryChannel and deliveryTarget must be provided together".to_owned(),
                )
            }
        };

        CronJobSpec::with_delivery_target(value.id, value.schedule, value.prompt, delivery_target)
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingDeliveryTarget {
    pub channel: String,
    pub target: String,
    pub topic: Option<String>,
}

impl TryFrom<BindingDeliveryTarget> for DeliveryTarget {
    type Error = String;

    fn try_from(value: BindingDeliveryTarget) -> Result<Self, Self::Error> {
        let channel = parse_channel_kind(&value.channel)?;
        let target =
            TargetKey::new(value.target).ok_or_else(|| "delivery target must not be empty".to_owned())?;

        Ok(DeliveryTarget::new(channel, target, value.topic))
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
