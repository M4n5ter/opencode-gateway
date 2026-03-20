//! Exported binding handle and focused binding tests.

use std::sync::Arc;

use boltffi::export;

use crate::binding::adapters::{CallbackRuntime, runtime_from_callbacks};
use crate::binding::{
    BindingClockHost, BindingCronJobSpec, BindingGatewayStatus, BindingInboundMessage,
    BindingLoggerHost, BindingOpencodeHost, BindingRuntimeReport, BindingStoreHost,
    BindingTransportHost,
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

    pub fn next_cron_run_at(&self, job: BindingCronJobSpec, after_ms: u64) -> Result<u64, String> {
        let job = opencode_gateway_core::CronJobSpec::try_from(job)?;
        job.next_run_at(after_ms).map_err(|error| error.to_string())
    }

    pub async fn handle_inbound_message(
        &self,
        message: BindingInboundMessage,
    ) -> Result<BindingRuntimeReport, String> {
        let message = opencode_gateway_core::InboundMessage::try_from(message)?;
        let report = self
            .runtime
            .handle_inbound_message(message)
            .await
            .map_err(|error| error.to_string())?;

        Ok(report.into())
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
        BindingClockHost, BindingCronJobSpec, BindingGatewayStatus, BindingHostAck,
        BindingInboundMessage, BindingLoggerHost, BindingOpencodeHost, BindingOutboundMessage,
        BindingPromptRequest, BindingPromptResult, BindingSessionBinding, BindingStoreHost,
        BindingTransportHost,
    };

    #[derive(Default)]
    struct MockStore;

    #[async_trait]
    impl BindingStoreHost for MockStore {
        async fn get_session_binding(&self, _conversation_key: String) -> BindingSessionBinding {
            BindingSessionBinding::ok(None)
        }

        async fn put_session_binding(
            &self,
            _conversation_key: String,
            _session_id: String,
            _recorded_at_ms: u64,
        ) -> BindingHostAck {
            BindingHostAck::ok()
        }

        async fn record_inbound_message(
            &self,
            _message: BindingInboundMessage,
            _recorded_at_ms: u64,
        ) -> BindingHostAck {
            BindingHostAck::ok()
        }

        async fn record_cron_dispatch(
            &self,
            _job: BindingCronJobSpec,
            _recorded_at_ms: u64,
        ) -> BindingHostAck {
            BindingHostAck::ok()
        }

        async fn record_delivery(
            &self,
            _message: BindingOutboundMessage,
            _recorded_at_ms: u64,
        ) -> BindingHostAck {
            BindingHostAck::ok()
        }
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
                session_id: Some("session-nightly".to_owned()),
                response_text: self.response_text.clone(),
                error_message: None,
            }
        }
    }

    #[derive(Default)]
    struct MockTransport;

    #[async_trait]
    impl BindingTransportHost for MockTransport {
        async fn send_message(&self, _message: BindingOutboundMessage) -> BindingHostAck {
            BindingHostAck::ok()
        }
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
            delivery_channel: None,
            delivery_target: None,
            delivery_topic: None,
        }))
        .expect("cron dispatch");

        assert_eq!(report.conversation_key, "cron:nightly");
        assert_eq!(report.response_text, "assistant reply");
        assert!(!report.delivered);
    }

    #[test]
    fn binding_handles_inbound_messages() {
        let binding = build_binding("reply from agent");

        let report = block_on(binding.handle_inbound_message(BindingInboundMessage {
            delivery_target: crate::BindingDeliveryTarget {
                channel: "telegram".to_owned(),
                target: "123".to_owned(),
                topic: Some("42".to_owned()),
            },
            sender: "telegram:7".to_owned(),
            body: "hello there".to_owned(),
        }))
        .expect("inbound dispatch");

        assert_eq!(report.conversation_key, "telegram:123:topic:42");
        assert_eq!(report.response_text, "reply from agent");
        assert!(report.delivered);
    }

    #[test]
    fn binding_computes_next_cron_occurrence() {
        let binding = build_binding("unused");

        let next = binding
            .next_cron_run_at(
                BindingCronJobSpec {
                    id: "nightly".to_owned(),
                    schedule: "0 9 * * *".to_owned(),
                    prompt: "Summarize work".to_owned(),
                    delivery_channel: None,
                    delivery_target: None,
                    delivery_topic: None,
                },
                1_735_689_600_000,
            )
            .expect("next cron occurrence");

        assert_eq!(next, 1_735_722_000_000);
    }
}
