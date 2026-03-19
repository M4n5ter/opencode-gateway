//! FFI-facing facade for the gateway.

use opencode_gateway_core::{ConversationKey, CronJobSpec, GatewayStatus};

/// Thin facade that mirrors the future BoltFFI entry surface.
#[derive(Debug, Default)]
pub struct GatewayEngineFacade {
    status: GatewayStatus,
}

impl GatewayEngineFacade {
    /// Creates a new scaffold facade.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the current scaffold status.
    #[must_use]
    pub fn status(&self) -> &GatewayStatus {
        &self.status
    }

    /// Builds a placeholder cron job payload that downstream FFI tests can assert on.
    #[must_use]
    pub fn scaffold_cron_job(&self, job_id: &str, schedule: &str, prompt: &str) -> CronJobSpec {
        CronJobSpec {
            id: job_id.trim().to_owned(),
            schedule: schedule.trim().to_owned(),
            prompt: prompt.trim().to_owned(),
            conversation_key: ConversationKey::for_cron_job(job_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::GatewayEngineFacade;

    #[test]
    fn scaffold_job_uses_cron_session_prefix() {
        let facade = GatewayEngineFacade::new();
        let spec = facade.scaffold_cron_job("nightly", "0 0 * * *", "Run nightly summary");

        assert_eq!(spec.conversation_key.as_str(), "cron:nightly");
    }
}
