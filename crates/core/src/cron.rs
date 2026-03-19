//! Cron job identifiers and validation.

use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::ConversationKey;

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
    EmptyPrompt,
}

impl Display for CronValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyId => f.write_str("cron job id must not be empty"),
            Self::EmptySchedule => f.write_str("cron schedule must not be empty"),
            Self::EmptyPrompt => f.write_str("cron prompt must not be empty"),
        }
    }
}

impl Error for CronValidationError {}

/// Canonical job definition used by pure gateway planning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronJobSpec {
    pub id: CronJobId,
    pub schedule: String,
    pub prompt: String,
    pub conversation_key: ConversationKey,
}

impl CronJobSpec {
    /// Builds a validated cron job definition and derives its logical session key.
    ///
    /// # Errors
    ///
    /// Returns a [`CronValidationError`] when the identifier, schedule, or prompt is empty after
    /// trimming.
    pub fn new(
        id: impl Into<String>,
        schedule: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Result<Self, CronValidationError> {
        let id = CronJobId::new(id)?;
        let schedule = schedule.into();
        let prompt = prompt.into();
        let schedule = normalize_schedule(&schedule)?;
        let prompt = normalize_prompt(&prompt)?;

        Ok(Self {
            conversation_key: ConversationKey::for_cron_job(id.as_str()),
            id,
            schedule,
            prompt,
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
}

fn normalize_schedule(value: &str) -> Result<String, CronValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CronValidationError::EmptySchedule);
    }

    Ok(trimmed.to_owned())
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
    use crate::cron::{CronJobSpec, CronValidationError};

    #[test]
    fn cron_job_rejects_empty_prompt() {
        let error = CronJobSpec::new("daily-summary", "0 9 * * *", "   ")
            .expect_err("expected empty prompt");

        assert_eq!(error, CronValidationError::EmptyPrompt);
    }
}
