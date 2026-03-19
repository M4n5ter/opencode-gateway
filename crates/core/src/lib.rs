//! Domain contracts for the opencode gateway.

/// Messaging platforms that the gateway can route through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChannelKind {
    Telegram,
}

impl ChannelKind {
    /// Returns the stable storage key used across config, persistence, and logs.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
        }
    }
}

/// A normalized channel target, such as a Telegram chat ID or future Slack channel ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TargetKey {
    value: String,
}

impl TargetKey {
    /// Creates a new target key after trimming surrounding whitespace.
    pub fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        let trimmed = value.trim();

        if trimmed.is_empty() {
            return None;
        }

        Some(Self {
            value: trimmed.to_owned(),
        })
    }

    /// Returns the normalized target key.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

/// Logical conversation identity that maps an inbound route to one OpenCode session.
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
    #[must_use]
    pub fn for_cron_job(job_id: impl AsRef<str>) -> Self {
        Self {
            value: format!("cron:{}", job_id.as_ref().trim()),
        }
    }

    /// Returns the stable storage value for the conversation key.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

/// Minimal summary of the current gateway state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayStatus {
    pub runtime_mode: &'static str,
    pub supports_telegram: bool,
    pub supports_cron: bool,
    pub has_web_ui: bool,
}

impl Default for GatewayStatus {
    fn default() -> Self {
        Self {
            runtime_mode: "scaffold",
            supports_telegram: true,
            supports_cron: true,
            has_web_ui: false,
        }
    }
}

/// Initial shape of a scheduled job definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronJobSpec {
    pub id: String,
    pub schedule: String,
    pub prompt: String,
    pub conversation_key: ConversationKey,
}

impl CronJobSpec {
    /// Validates the minimal fields we care about during scaffolding.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("cron job id must not be empty");
        }

        if self.schedule.trim().is_empty() {
            return Err("cron schedule must not be empty");
        }

        if self.prompt.trim().is_empty() {
            return Err("cron prompt must not be empty");
        }

        Ok(())
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
    use super::{ChannelKind, ConversationKey, CronJobSpec, TargetKey};

    #[test]
    fn target_key_rejects_blank_input() {
        assert!(TargetKey::new("   ").is_none());
    }

    #[test]
    fn conversation_key_is_stable_for_telegram_targets() {
        let target = TargetKey::new("-100123456").expect("target key");
        let key = ConversationKey::for_target(ChannelKind::Telegram, &target, Some("42"));

        assert_eq!(key.as_str(), "telegram:-100123456:topic:42");
    }

    #[test]
    fn cron_job_requires_non_empty_fields() {
        let spec = CronJobSpec {
            id: "daily-summary".to_owned(),
            schedule: "0 9 * * *".to_owned(),
            prompt: "Summarize changes since yesterday".to_owned(),
            conversation_key: ConversationKey::for_cron_job("daily-summary"),
        };

        assert_eq!(spec.validate(), Ok(()));
    }
}
