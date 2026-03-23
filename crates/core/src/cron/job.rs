use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::{ConversationKey, DeliveryTarget};

use super::schedule::{next_run_at, normalize_schedule};

/// Stable identifier for a persisted cron job.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CronJobId {
    value: String,
}

impl CronJobId {
    /// Creates a new cron job identifier after trimming surrounding whitespace.
    ///
    /// # Errors
    ///
    /// Returns [`CronValidationError::EmptyId`] when the trimmed identifier is empty.
    pub fn new(value: impl Into<String>) -> Result<Self, CronValidationError> {
        let value = value.into();
        let trimmed = value.trim();

        if trimmed.is_empty() {
            return Err(CronValidationError::EmptyId);
        }

        Ok(Self {
            value: trimmed.to_owned(),
        })
    }

    /// Returns the stable string representation of the cron job identifier.
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

/// Validation failures for a cron job definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CronValidationError {
    EmptyId,
    EmptySchedule,
    InvalidSchedule(String),
    InvalidTimeZone(String),
    EmptyPrompt,
    NextOccurrenceOutOfRange,
}

impl Display for CronValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyId => f.write_str("cron job id must not be empty"),
            Self::EmptySchedule => f.write_str("cron schedule must not be empty"),
            Self::InvalidSchedule(message) => write!(f, "invalid cron schedule: {message}"),
            Self::InvalidTimeZone(message) => write!(f, "invalid cron time zone: {message}"),
            Self::EmptyPrompt => f.write_str("cron prompt must not be empty"),
            Self::NextOccurrenceOutOfRange => {
                f.write_str("next cron occurrence is out of range for unix milliseconds")
            }
        }
    }
}

impl Error for CronValidationError {}

/// Canonical recurring job definition used by pure gateway planning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronJobSpec {
    pub id: CronJobId,
    pub schedule: String,
    pub prompt: String,
    pub conversation_key: ConversationKey,
    pub delivery_target: Option<DeliveryTarget>,
}

impl CronJobSpec {
    /// Builds a validated cron job definition and derives its logical session key.
    ///
    /// # Errors
    ///
    /// Returns a [`CronValidationError`] when the identifier, schedule, or prompt is invalid.
    pub fn new(
        id: impl Into<String>,
        schedule: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Result<Self, CronValidationError> {
        Self::with_delivery_target(id, schedule, prompt, None)
    }

    /// Builds a validated cron job definition with an optional outbound delivery target.
    ///
    /// # Errors
    ///
    /// Returns a [`CronValidationError`] when the identifier, schedule, or prompt is invalid.
    pub fn with_delivery_target(
        id: impl Into<String>,
        schedule: impl Into<String>,
        prompt: impl Into<String>,
        delivery_target: Option<DeliveryTarget>,
    ) -> Result<Self, CronValidationError> {
        let id = CronJobId::new(id)?;
        let schedule = normalize_schedule(&schedule.into())?;
        let prompt = normalize_prompt(&prompt.into())?;

        Ok(Self {
            conversation_key: ConversationKey::for_cron_job(id.as_str()),
            id,
            schedule,
            prompt,
            delivery_target,
        })
    }

    /// Re-validates the current fields without rebuilding the struct.
    ///
    /// # Errors
    ///
    /// Returns the first [`CronValidationError`] found in the current field values.
    pub fn validate(&self) -> Result<(), CronValidationError> {
        let _ = CronJobId::new(self.id.as_str())?;
        let _ = normalize_schedule(&self.schedule)?;
        let _ = normalize_prompt(&self.prompt)?;
        Ok(())
    }

    /// Computes the next future occurrence for this recurring cron expression.
    ///
    /// # Errors
    ///
    /// Returns a [`CronValidationError`] when the schedule is invalid or the next occurrence
    /// cannot be represented as unix milliseconds.
    pub fn next_run_at(
        &self,
        after_unix_ms: u64,
        time_zone: &str,
    ) -> Result<u64, CronValidationError> {
        self.validate()?;
        next_run_at(&self.schedule, after_unix_ms, time_zone)
    }
}

fn normalize_prompt(value: &str) -> Result<String, CronValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CronValidationError::EmptyPrompt);
    }

    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use crate::{ChannelKind, CronJobSpec, CronValidationError, DeliveryTarget, TargetKey};

    #[test]
    fn cron_job_rejects_empty_prompt() {
        let error = CronJobSpec::new("daily-summary", "0 9 * * *", "   ")
            .expect_err("expected empty prompt");

        assert_eq!(error, CronValidationError::EmptyPrompt);
    }

    #[test]
    fn cron_job_preserves_delivery_target() {
        let job = CronJobSpec::with_delivery_target(
            "nightly",
            "0 9 * * *",
            "Summarize work",
            Some(DeliveryTarget::new(
                ChannelKind::Telegram,
                TargetKey::new("123").expect("target"),
                Some("42".to_owned()),
            )),
        )
        .expect("cron job");

        assert_eq!(
            job.delivery_target
                .expect("delivery target")
                .conversation_key()
                .as_str(),
            "telegram:123:topic:42"
        );
    }
}
