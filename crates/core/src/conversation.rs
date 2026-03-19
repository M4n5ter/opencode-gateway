//! Stable logical conversation identifiers.

use crate::channel::{ChannelKind, TargetKey};

/// Logical conversation identity that maps an inbound route to one `OpenCode` session.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConversationKey {
    value: String,
}

impl ConversationKey {
    /// Creates a stable conversation key from channel and target information.
    pub fn for_target(channel: ChannelKind, target: &TargetKey, topic: Option<&str>) -> Self {
        let mut value = format!("{}:{}", channel.as_str(), target.as_str());

        if let Some(topic) = topic.and_then(normalize_topic) {
            value.push_str(":topic:");
            value.push_str(&topic);
        }

        Self { value }
    }

    /// Creates the logical session key for a scheduled job.
    pub fn for_cron_job(job_id: impl AsRef<str>) -> Self {
        Self {
            value: format!("cron:{}", job_id.as_ref().trim()),
        }
    }

    /// Returns the stable storage value for the conversation key.
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

fn normalize_topic(topic: &str) -> Option<String> {
    let trimmed = topic.trim();

    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use crate::{ChannelKind, TargetKey};

    use super::ConversationKey;

    #[test]
    fn conversation_key_is_stable_for_telegram_targets() {
        let target = TargetKey::new("-100123456").expect("target key");
        let key = ConversationKey::for_target(ChannelKind::Telegram, &target, Some("42"));

        assert_eq!(key.as_str(), "telegram:-100123456:topic:42");
    }

    #[test]
    fn empty_topic_is_ignored() {
        let target = TargetKey::new("123").expect("target key");
        let key = ConversationKey::for_target(ChannelKind::Telegram, &target, Some("   "));

        assert_eq!(key.as_str(), "telegram:123");
    }
}
