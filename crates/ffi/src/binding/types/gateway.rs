use opencode_gateway_core::{
    CronJobSpec, DeliveryTarget, GatewayStatus, InboundAttachment, InboundMessage,
    PreparedExecution, PromptPart, ReplyAttachmentSummary, ReplyContext, TargetKey,
};
use serde::{Deserialize, Serialize};

use super::{normalize_optional_identifier, parse_channel_kind, parse_required};

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
    pub prompt_parts: Vec<BindingPromptPart>,
    pub reply_target: Option<BindingDeliveryTarget>,
}

impl From<PreparedExecution> for BindingPreparedExecution {
    fn from(value: PreparedExecution) -> Self {
        Self {
            conversation_key: value.conversation_key,
            prompt_parts: value
                .prompt_parts
                .into_iter()
                .map(BindingPromptPart::from)
                .collect(),
            reply_target: value.reply_target.map(BindingDeliveryTarget::from),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingPromptPart {
    Text {
        text: String,
    },
    File {
        mime_type: String,
        file_name: Option<String>,
        local_path: String,
    },
}

impl From<PromptPart> for BindingPromptPart {
    fn from(value: PromptPart) -> Self {
        match value {
            PromptPart::Text(text) => Self::Text { text },
            PromptPart::File {
                mime_type,
                file_name,
                local_path,
            } => Self::File {
                mime_type,
                file_name,
                local_path,
            },
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
    pub text: Option<String>,
    pub attachments: Vec<BindingInboundAttachment>,
    pub mailbox_key: Option<String>,
    pub reply_context: Option<BindingReplyContext>,
}

impl TryFrom<BindingInboundMessage> for InboundMessage {
    type Error = String;

    fn try_from(value: BindingInboundMessage) -> Result<Self, Self::Error> {
        let delivery_target: DeliveryTarget = value.delivery_target.try_into()?;
        let sender = parse_required(value.sender, "message sender")?;
        let attachments = value
            .attachments
            .into_iter()
            .map(InboundAttachment::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        let mut message = InboundMessage::new(
            delivery_target.channel,
            delivery_target.target,
            delivery_target.topic,
            sender,
            normalize_optional_identifier(value.text),
            attachments,
        )
        .map_err(|error| error.to_string())?;

        if let Some(mailbox_key) = value.mailbox_key {
            message
                .set_conversation_key_override(mailbox_key)
                .map_err(|error| error.to_string())?;
        }
        if let Some(reply_context) = value.reply_context {
            message.set_reply_context(reply_context.try_into()?);
        }

        Ok(message)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingReplyContext {
    pub message_id: String,
    pub sender: Option<String>,
    pub sender_is_bot: Option<bool>,
    pub text: Option<String>,
    pub text_truncated: bool,
    pub attachments: Vec<BindingReplyContextAttachment>,
}

impl TryFrom<BindingReplyContext> for ReplyContext {
    type Error = String;

    fn try_from(value: BindingReplyContext) -> Result<Self, Self::Error> {
        let attachments = value
            .attachments
            .into_iter()
            .map(ReplyAttachmentSummary::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        ReplyContext::new(
            value.message_id,
            normalize_optional_identifier(value.sender),
            value.sender_is_bot,
            normalize_optional_identifier(value.text),
            value.text_truncated,
            attachments,
        )
        .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingReplyContextAttachment {
    Image {
        mime_type: Option<String>,
        file_name: Option<String>,
    },
}

impl TryFrom<BindingReplyContextAttachment> for ReplyAttachmentSummary {
    type Error = String;

    fn try_from(value: BindingReplyContextAttachment) -> Result<Self, Self::Error> {
        match value {
            BindingReplyContextAttachment::Image {
                mime_type,
                file_name,
            } => Ok(ReplyAttachmentSummary::image(mime_type, file_name)),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingInboundAttachment {
    Image {
        mime_type: String,
        file_name: Option<String>,
        local_path: String,
    },
}

impl TryFrom<BindingInboundAttachment> for InboundAttachment {
    type Error = String;

    fn try_from(value: BindingInboundAttachment) -> Result<Self, Self::Error> {
        match value {
            BindingInboundAttachment::Image {
                mime_type,
                file_name,
                local_path,
            } => InboundAttachment::image(mime_type, file_name, local_path)
                .map_err(|error| error.to_string()),
        }
    }
}
