//! BoltFFI-facing gateway exports.

use std::time::{SystemTime, UNIX_EPOCH};

use boltffi::*;
use opencode_gateway_core::{CronJobSpec, GatewayStatus, PromptRequest};

use crate::{
    GatewayRuntime, HostClock, HostLogger, HostOpencode, HostResult, HostStore, HostTransport,
    LogLevel, RuntimeReport,
};

type LocalRuntime = GatewayRuntime<NoopStore, EchoOpencode, NoopTransport, SystemClock, NoopLogger>;

#[derive(Debug, Default)]
struct NoopStore;

impl HostStore for NoopStore {
    async fn record_inbound_message(
        &self,
        _message: &opencode_gateway_core::InboundMessage,
        _recorded_at_ms: u64,
    ) -> HostResult<()> {
        Ok(())
    }

    async fn record_cron_dispatch(
        &self,
        _job: &CronJobSpec,
        _recorded_at_ms: u64,
    ) -> HostResult<()> {
        Ok(())
    }

    async fn record_delivery(
        &self,
        _message: &opencode_gateway_core::OutboundMessage,
        _recorded_at_ms: u64,
    ) -> HostResult<()> {
        Ok(())
    }
}

#[derive(Debug, Default)]
struct EchoOpencode;

impl HostOpencode for EchoOpencode {
    async fn run_prompt(&self, request: &PromptRequest) -> HostResult<String> {
        Ok(format!("echo: {}", request.prompt))
    }
}

#[derive(Debug, Default)]
struct NoopTransport;

impl HostTransport for NoopTransport {
    async fn send_message(
        &self,
        _message: &opencode_gateway_core::OutboundMessage,
    ) -> HostResult<()> {
        Ok(())
    }
}

#[derive(Debug, Default)]
struct SystemClock;

impl HostClock for SystemClock {
    fn now_unix_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis() as u64)
    }
}

#[derive(Debug, Default)]
struct NoopLogger;

impl HostLogger for NoopLogger {
    fn log(&self, _level: LogLevel, _message: &str) {}
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
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

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingCronJobSpec {
    pub id: String,
    pub schedule: String,
    pub prompt: String,
}

impl TryFrom<BindingCronJobSpec> for CronJobSpec {
    type Error = String;

    fn try_from(value: BindingCronJobSpec) -> Result<Self, Self::Error> {
        CronJobSpec::new(value.id, value.schedule, value.prompt).map_err(|error| error.to_string())
    }
}

#[data]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BindingRuntimeReport {
    pub conversation_key: String,
    pub response_text: String,
    pub delivered: bool,
    pub recorded_at_ms: u64,
}

impl From<RuntimeReport> for BindingRuntimeReport {
    fn from(value: RuntimeReport) -> Self {
        Self {
            conversation_key: value.conversation_key.as_str().to_owned(),
            response_text: value.response_text,
            delivered: value.delivered,
            recorded_at_ms: value.recorded_at_ms,
        }
    }
}

fn build_runtime() -> LocalRuntime {
    GatewayRuntime::new(
        opencode_gateway_core::GatewayEngine::new(),
        NoopStore,
        EchoOpencode,
        NoopTransport,
        SystemClock,
        NoopLogger,
    )
}

#[export]
pub fn gateway_status() -> BindingGatewayStatus {
    build_runtime().status().into()
}

#[export]
pub async fn dispatch_cron_job(job: BindingCronJobSpec) -> Result<BindingRuntimeReport, String> {
    let job = CronJobSpec::try_from(job)?;
    let report = build_runtime()
        .dispatch_cron_job(&job)
        .await
        .map_err(|error| error.to_string())?;

    Ok(report.into())
}

#[cfg(test)]
mod tests {
    use pollster::block_on;

    use crate::{BindingCronJobSpec, binding::gateway_status};

    #[test]
    fn binding_reports_runtime_status() {
        let status = gateway_status();

        assert_eq!(status.runtime_mode, "contract");
        assert!(status.supports_cron);
        assert!(status.supports_telegram);
        assert!(!status.has_web_ui);
    }

    #[test]
    fn binding_dispatches_cron_jobs() {
        let report = block_on(super::dispatch_cron_job(BindingCronJobSpec {
            id: "nightly".to_owned(),
            schedule: "0 0 * * *".to_owned(),
            prompt: "Summarize work".to_owned(),
        }))
        .expect("cron dispatch");

        assert_eq!(report.conversation_key, "cron:nightly");
        assert_eq!(report.response_text, "echo: Summarize work");
        assert!(!report.delivered);
    }
}
