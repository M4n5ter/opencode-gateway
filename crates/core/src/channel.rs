//! Channel identifiers and normalization helpers.

/// Messaging platforms that the gateway can route through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChannelKind {
    Telegram,
}

impl ChannelKind {
    /// Returns the stable storage key used across config, persistence, and logs.
    pub const fn as_str(self) -> &'static str {
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
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

#[cfg(test)]
mod tests {
    use super::TargetKey;

    #[test]
    fn target_key_rejects_blank_input() {
        assert!(TargetKey::new("   ").is_none());
    }
}
