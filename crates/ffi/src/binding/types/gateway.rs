use opencode_gateway_core::{
    CronJobSpec, DeliveryTarget, GatewayStatus, InboundMessage, PreparedExecution, TargetKey,
};
use serde::{Deserialize, Serialize};

use super::{parse_channel_kind, parse_required};

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
#[serde(rename_all = "camelCase")]
pub struct BindingInboundMessage {
    pub delivery_target: BindingDeliveryTarget,
    pub sender: String,
    pub body: String,
    pub mailbox_key: Option<String>,
}

impl TryFrom<BindingInboundMessage> for InboundMessage {
    type Error = String;

    fn try_from(value: BindingInboundMessage) -> Result<Self, Self::Error> {
        let delivery_target: DeliveryTarget = value.delivery_target.try_into()?;
        let sender = parse_required(value.sender, "message sender")?;
        let body = parse_required(value.body, "message body")?;

        let mut message = InboundMessage::new(
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
