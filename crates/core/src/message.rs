//! Inbound, outbound, and prompt-carrying message types.

use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::{ChannelKind, ConversationKey, CronJobId, TargetKey};

/// Validation failures for inbound user messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageValidationError {
    EmptySender,
    EmptyBody,
}

impl Display for MessageValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptySender => f.write_str("message sender must not be empty"),
            Self::EmptyBody => f.write_str("message body must not be empty"),
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    pub delivery_target: DeliveryTarget,
    pub sender: String,
    pub body: String,
}

impl InboundMessage {
    /// Creates a validated inbound message and normalizes surrounding whitespace.
    ///
    /// # Errors
    ///
    /// Returns [`MessageValidationError::EmptySender`] or
    /// [`MessageValidationError::EmptyBody`] when the trimmed values are empty.
    pub fn new(
        channel: ChannelKind,
        target: TargetKey,
        topic: Option<String>,
        sender: impl Into<String>,
        body: impl Into<String>,
    ) -> Result<Self, MessageValidationError> {
        let sender = sender.into();
        let body = body.into();
        let sender = normalize_sender(&sender)?;
        let body = normalize_body(&body)?;

        Ok(Self {
            delivery_target: DeliveryTarget::new(channel, target, topic),
            sender,
            body,
        })
    }

    /// Returns the logical conversation key for the inbound message route.
    pub fn conversation_key(&self) -> ConversationKey {
        self.delivery_target.conversation_key()
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

/// A single `OpenCode` prompt to execute against a logical conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptRequest {
    pub conversation_key: ConversationKey,
    pub prompt: String,
    pub source: PromptSource,
}

impl PromptRequest {
    /// Creates a prompt request with a normalized prompt body.
    pub fn new(
        conversation_key: ConversationKey,
        prompt: impl Into<String>,
        source: PromptSource,
    ) -> Self {
        Self {
            conversation_key,
            prompt: prompt.into().trim().to_owned(),
            source,
        }
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

fn normalize_body(value: &str) -> Result<String, MessageValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(MessageValidationError::EmptyBody);
    }

    Ok(trimmed.to_owned())
}

fn normalize_topic(value: Option<String>) -> Option<String> {
    value.and_then(|topic| {
        let trimmed = topic.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

#[cfg(test)]
mod tests {
    use crate::{ChannelKind, InboundMessage, MessageValidationError, TargetKey};

    #[test]
    fn inbound_message_rejects_empty_sender() {
        let target = TargetKey::new("123").expect("target key");
        let error = InboundMessage::new(ChannelKind::Telegram, target, None, "   ", "hello")
            .expect_err("expected empty sender");

        assert_eq!(error, MessageValidationError::EmptySender);
    }
}
