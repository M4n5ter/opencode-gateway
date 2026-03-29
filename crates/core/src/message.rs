//! Inbound, outbound, and prompt-carrying message types.

use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::{ChannelKind, ConversationKey, CronJobId, TargetKey};

/// Validation failures for inbound user messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageValidationError {
    EmptySender,
    EmptyContent,
    EmptyReplyMessageId,
    EmptyAttachmentMimeType,
    EmptyAttachmentLocalPath,
}

impl Display for MessageValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptySender => f.write_str("message sender must not be empty"),
            Self::EmptyContent => {
                f.write_str("message must include non-empty text or at least one attachment")
            }
            Self::EmptyReplyMessageId => f.write_str("reply message id must not be empty"),
            Self::EmptyAttachmentMimeType => {
                f.write_str("message attachment mime type must not be empty")
            }
            Self::EmptyAttachmentLocalPath => {
                f.write_str("message attachment local path must not be empty")
            }
        }
    }
}

impl Error for MessageValidationError {}

/// Where a reply should be delivered after an `OpenCode` prompt completes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryTarget {
    pub channel: ChannelKind,
    pub target: TargetKey,
    pub topic: Option<String>,
}

impl DeliveryTarget {
    /// Creates a delivery target from normalized channel routing data.
    pub fn new(channel: ChannelKind, target: TargetKey, topic: Option<String>) -> Self {
        Self {
            channel,
            target,
            topic: normalize_topic(topic),
        }
    }

    /// Returns the logical conversation key associated with this target.
    pub fn conversation_key(&self) -> ConversationKey {
        ConversationKey::for_target(self.channel, &self.target, self.topic.as_deref())
    }
}

/// A normalized inbound chat message received from an IM channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboundAttachmentKind {
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundAttachment {
    pub kind: InboundAttachmentKind,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub local_path: String,
}

impl InboundAttachment {
    pub fn image(
        mime_type: impl Into<String>,
        file_name: Option<String>,
        local_path: impl Into<String>,
    ) -> Result<Self, MessageValidationError> {
        Ok(Self {
            kind: InboundAttachmentKind::Image,
            mime_type: normalize_attachment_mime_type(&mime_type.into())?,
            file_name: normalize_optional_text(file_name),
            local_path: normalize_attachment_local_path(&local_path.into())?,
        })
    }

    pub fn to_prompt_part(&self) -> PromptPart {
        PromptPart::File {
            mime_type: self.mime_type.clone(),
            file_name: self.file_name.clone(),
            local_path: self.local_path.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyAttachmentKind {
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyAttachmentSummary {
    pub kind: ReplyAttachmentKind,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
}

impl ReplyAttachmentSummary {
    pub fn image(mime_type: Option<String>, file_name: Option<String>) -> Self {
        Self {
            kind: ReplyAttachmentKind::Image,
            mime_type: normalize_optional_text(mime_type),
            file_name: normalize_optional_text(file_name),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyContext {
    pub message_id: String,
    pub sender: Option<String>,
    pub sender_is_bot: Option<bool>,
    pub text: Option<String>,
    pub text_truncated: bool,
    pub attachments: Vec<ReplyAttachmentSummary>,
}

impl ReplyContext {
    pub fn new(
        message_id: impl Into<String>,
        sender: Option<String>,
        sender_is_bot: Option<bool>,
        text: Option<String>,
        text_truncated: bool,
        attachments: Vec<ReplyAttachmentSummary>,
    ) -> Result<Self, MessageValidationError> {
        let message_id = normalize_reply_message_id(&message_id.into())?;

        Ok(Self {
            message_id,
            sender: normalize_optional_text(sender),
            sender_is_bot,
            text: normalize_optional_text(text),
            text_truncated,
            attachments,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    pub delivery_target: DeliveryTarget,
    pub sender: String,
    pub text: Option<String>,
    pub attachments: Vec<InboundAttachment>,
    pub reply_context: Option<ReplyContext>,
    conversation_key_override: Option<ConversationKey>,
}

impl InboundMessage {
    /// Creates a validated inbound message and normalizes surrounding whitespace.
    ///
    /// # Errors
    ///
    /// Returns [`MessageValidationError::EmptySender`] when the sender is empty,
    /// or [`MessageValidationError::EmptyContent`] when both text and attachments
    /// are absent after normalization.
    pub fn new(
        channel: ChannelKind,
        target: TargetKey,
        topic: Option<String>,
        sender: impl Into<String>,
        text: Option<String>,
        attachments: Vec<InboundAttachment>,
    ) -> Result<Self, MessageValidationError> {
        let sender = sender.into();
        let sender = normalize_sender(&sender)?;
        let text = normalize_optional_text(text);
        if text.is_none() && attachments.is_empty() {
            return Err(MessageValidationError::EmptyContent);
        }

        Ok(Self {
            delivery_target: DeliveryTarget::new(channel, target, topic),
            sender,
            text,
            attachments,
            reply_context: None,
            conversation_key_override: None,
        })
    }

    /// Returns the logical conversation key for the inbound message route.
    pub fn conversation_key(&self) -> ConversationKey {
        self.conversation_key_override
            .clone()
            .unwrap_or_else(|| self.delivery_target.conversation_key())
    }

    /// Overrides the default mailbox/session key for this inbound message.
    pub fn set_conversation_key_override(
        &mut self,
        conversation_key: impl Into<String>,
    ) -> Result<(), MessageValidationError> {
        let conversation_key = normalize_body(&conversation_key.into())?;
        self.conversation_key_override = Some(ConversationKey::for_override(conversation_key));
        Ok(())
    }

    pub fn set_reply_context(&mut self, reply_context: ReplyContext) {
        self.reply_context = Some(reply_context);
    }
}

/// The source that produced a prompt request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptSource {
    InboundMessage {
        channel: ChannelKind,
        sender: String,
    },
    CronJob {
        id: CronJobId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptPart {
    Text(String),
    File {
        mime_type: String,
        file_name: Option<String>,
        local_path: String,
    },
}

impl PromptPart {
    pub fn text(text: impl Into<String>) -> Result<Self, MessageValidationError> {
        let text = normalize_body(&text.into())?;
        Ok(Self::Text(text))
    }

    pub fn file(
        mime_type: impl Into<String>,
        file_name: Option<String>,
        local_path: impl Into<String>,
    ) -> Result<Self, MessageValidationError> {
        Ok(Self::File {
            mime_type: normalize_attachment_mime_type(&mime_type.into())?,
            file_name: normalize_optional_text(file_name),
            local_path: normalize_attachment_local_path(&local_path.into())?,
        })
    }
}

/// A single `OpenCode` prompt to execute against a logical conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptRequest {
    pub conversation_key: ConversationKey,
    pub parts: Vec<PromptPart>,
    pub source: PromptSource,
}

impl PromptRequest {
    /// Creates a prompt request with normalized prompt parts.
    pub fn with_parts(
        conversation_key: ConversationKey,
        parts: Vec<PromptPart>,
        source: PromptSource,
    ) -> Self {
        Self {
            conversation_key,
            parts,
            source,
        }
    }

    /// Creates a prompt request from a single text prompt.
    pub fn from_text(
        conversation_key: ConversationKey,
        prompt: impl Into<String>,
        source: PromptSource,
    ) -> Result<Self, MessageValidationError> {
        Ok(Self::with_parts(
            conversation_key,
            vec![PromptPart::text(prompt)?],
            source,
        ))
    }
}

/// A channel message that should be delivered by the host transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundMessage {
    pub delivery_target: DeliveryTarget,
    pub body: String,
}

impl OutboundMessage {
    /// Creates an outbound message from the transport target and response body.
    pub fn new(delivery_target: DeliveryTarget, body: impl Into<String>) -> Self {
        Self {
            delivery_target,
            body: body.into(),
        }
    }
}

fn normalize_sender(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptySender);
    }

    Ok(trimmed.to_owned())
}

fn normalize_reply_message_id(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptyReplyMessageId);
    }

    Ok(trimmed.to_owned())
}

fn normalize_body(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptyContent);
    }

    Ok(trimmed.to_owned())
}

fn normalize_attachment_mime_type(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptyAttachmentMimeType);
    }

    Ok(trimmed.to_owned())
}

fn normalize_attachment_local_path(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptyAttachmentLocalPath);
    }

    Ok(trimmed.to_owned())
}

fn normalize_topic(value: Option<String>) -> Option<String> {
    normalize_optional_text(value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use crate::{
        ChannelKind, InboundAttachment, InboundMessage, MessageValidationError, TargetKey,
    };

    #[test]
    fn inbound_message_rejects_empty_sender() {
        let target = TargetKey::new("123").expect("target key");
        let error = InboundMessage::new(
            ChannelKind::Telegram,
            target,
            None,
            "   ",
            Some("hello".to_owned()),
            vec![],
        )
        .expect_err("expected empty sender");

        assert_eq!(error, MessageValidationError::EmptySender);
    }

    #[test]
    fn inbound_message_accepts_image_without_text() {
        let target = TargetKey::new("123").expect("target key");
        let attachment =
            InboundAttachment::image("image/png", Some("photo.png".to_owned()), "/tmp/photo.png")
                .expect("attachment");

        let message = InboundMessage::new(
            ChannelKind::Telegram,
            target,
            None,
            "alice",
            None,
            vec![attachment],
        )
        .expect("message");

        assert!(message.text.is_none());
        assert_eq!(message.attachments.len(), 1);
    }
}
