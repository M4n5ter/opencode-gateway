//! Exported binding handle and focused binding tests.

use std::sync::Arc;

use boltffi::export;

use crate::binding::adapters::{CallbackRuntime, runtime_from_callbacks};
use crate::binding::{
    BindingClockHost, BindingCronJobSpec, BindingGatewayStatus, BindingLoggerHost,
    BindingOpencodeHost, BindingRuntimeReport, BindingStoreHost, BindingTransportHost,
};

pub struct GatewayBinding {
    runtime: CallbackRuntime,
}

#[export]
impl GatewayBinding {
    pub fn new(
        store: Arc<dyn BindingStoreHost>,
        opencode: Arc<dyn BindingOpencodeHost>,
        transport: Arc<dyn BindingTransportHost>,
        clock: Arc<dyn BindingClockHost>,
        logger: Arc<dyn BindingLoggerHost>,
    ) -> Self {
        Self {
            runtime: runtime_from_callbacks(store, opencode, transport, clock, logger),
        }
    }

    pub fn status(&self) -> BindingGatewayStatus {
        self.runtime.status().into()
    }

    pub async fn dispatch_cron_job(
        &self,
        job: BindingCronJobSpec,
    ) -> Result<BindingRuntimeReport, String> {
        let job = opencode_gateway_core::CronJobSpec::try_from(job)?;
        let report = self
            .runtime
            .dispatch_cron_job(&job)
            .await
            .map_err(|error| error.to_string())?;

        Ok(report.into())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use pollster::block_on;

    use super::GatewayBinding;
    use crate::binding::{
        BindingClockHost, BindingCronJobSpec, BindingGatewayStatus, BindingInboundMessage,
        BindingLoggerHost, BindingOpencodeHost, BindingOutboundMessage, BindingPromptRequest,
        BindingPromptResult, BindingStoreHost, BindingTransportHost,
    };

    #[derive(Default)]
    struct MockStore;

    #[async_trait]
    impl BindingStoreHost for MockStore {
        async fn get_session_binding(&self, _conversation_key: String) -> Option<String> {
            None
        }

        async fn put_session_binding(
            &self,
            _conversation_key: String,
            _session_id: String,
            _recorded_at_ms: u64,
        ) {
        }

        async fn record_inbound_message(
            &self,
            _message: BindingInboundMessage,
            _recorded_at_ms: u64,
        ) {
        }

        async fn record_cron_dispatch(&self, _job: BindingCronJobSpec, _recorded_at_ms: u64) {}

        async fn record_delivery(&self, _message: BindingOutboundMessage, _recorded_at_ms: u64) {}
    }

    struct MockOpencode {
        response_text: String,
        prompts: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl BindingOpencodeHost for MockOpencode {
        async fn run_prompt(&self, request: BindingPromptRequest) -> BindingPromptResult {
            self.prompts
                .lock()
                .expect("prompt lock")
                .push(request.prompt);
            BindingPromptResult {
                session_id: "session-nightly".to_owned(),
                response_text: self.response_text.clone(),
            }
        }
    }

    #[derive(Default)]
    struct MockTransport;

    #[async_trait]
    impl BindingTransportHost for MockTransport {
        async fn send_message(&self, _message: BindingOutboundMessage) {}
    }

    struct MockClock;

    impl BindingClockHost for MockClock {
        fn now_unix_ms(&self) -> u64 {
            4242
        }
    }

    #[derive(Default)]
    struct MockLogger;

    impl BindingLoggerHost for MockLogger {
        fn log(&self, _level: String, _message: String) {}
    }

    fn build_binding(response_text: &str) -> GatewayBinding {
        GatewayBinding::new(
            Arc::new(MockStore),
            Arc::new(MockOpencode {
                response_text: response_text.to_owned(),
                prompts: Mutex::default(),
            }),
            Arc::new(MockTransport),
            Arc::new(MockClock),
            Arc::new(MockLogger),
        )
    }

    #[test]
    fn binding_reports_runtime_status() {
        let binding = build_binding("unused");

        let status: BindingGatewayStatus = binding.status();

        assert_eq!(status.runtime_mode, "contract");
        assert!(status.supports_cron);
        assert!(status.supports_telegram);
        assert!(!status.has_web_ui);
    }

    #[test]
    fn binding_dispatches_cron_jobs() {
        let binding = build_binding("assistant reply");

        let report = block_on(binding.dispatch_cron_job(BindingCronJobSpec {
            id: "nightly".to_owned(),
            schedule: "0 0 * * *".to_owned(),
            prompt: "Summarize work".to_owned(),
        }))
        .expect("cron dispatch");

        assert_eq!(report.conversation_key, "cron:nightly");
        assert_eq!(report.response_text, "assistant reply");
        assert!(!report.delivered);
    }
}
