use std::str::FromStr;

use chrono::{TimeZone, Utc};
use cron::Schedule;

use super::job::CronValidationError;

pub(super) fn normalize_schedule(value: &str) -> Result<String, CronValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CronValidationError::EmptySchedule);
    }

    validate_field_count(trimmed)?;

    parse_schedule(trimmed)?;
    Ok(trimmed.to_owned())
}

pub(super) fn next_run_at(schedule: &str, after_unix_ms: u64) -> Result<u64, CronValidationError> {
    let cron = parse_schedule(schedule)?;
    let after_unix_ms =
        i64::try_from(after_unix_ms).map_err(|_| CronValidationError::NextOccurrenceOutOfRange)?;
    let start = Utc
        .timestamp_millis_opt(after_unix_ms)
        .single()
        .ok_or(CronValidationError::NextOccurrenceOutOfRange)?;
    let next = cron
        .after(&start)
        .next()
        .ok_or(CronValidationError::NextOccurrenceOutOfRange)?;

    u64::try_from(next.timestamp_millis())
        .map_err(|_| CronValidationError::NextOccurrenceOutOfRange)
}

fn parse_schedule(value: &str) -> Result<Schedule, CronValidationError> {
    validate_field_count(value)?;
    let normalized = normalize_for_cron_parser(value);

    Schedule::from_str(&normalized)
        .map_err(|error| CronValidationError::InvalidSchedule(error.to_string()))
}

fn normalize_for_cron_parser(value: &str) -> String {
    format!("0 {value}")
}

fn validate_field_count(value: &str) -> Result<(), CronValidationError> {
    if value.split_whitespace().count() != 5 {
        return Err(CronValidationError::InvalidSchedule(
            "expected a 5-field recurring cron expression".to_owned(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{next_run_at, normalize_schedule};
    use crate::CronValidationError;

    #[test]
    fn recurring_cron_rejects_six_field_schedules() {
        let error = normalize_schedule("0 0 9 * * *").expect_err("expected invalid schedule");

        assert!(matches!(error, CronValidationError::InvalidSchedule(_)));
    }

    #[test]
    fn recurring_cron_computes_next_future_occurrence() {
        let next = next_run_at("0 9 * * *", 1_735_689_600_000).expect("next occurrence");

        assert_eq!(next, 1_735_722_000_000);
    }
}
