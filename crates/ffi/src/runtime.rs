//! Runtime orchestration between the pure engine and host capabilities.

use std::error::Error;
use std::fmt::{Display, Formatter};

use opencode_gateway_core::{
    ConversationKey, CronJobSpec, CronValidationError, GatewayEngine, GatewayPlan, GatewayStatus,
    InboundMessage,
};

use crate::host::{
    HostClock, HostFailure, HostLogger, HostOpencode, HostStore, HostTransport, LogLevel,
};

/// Runtime-level failures combining core validation and host execution failures.
#[derive(Debug)]
pub enum RuntimeError {
    Host(HostFailure),
    InvalidCronJob(CronValidationError),
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Host(error) => Display::fmt(error, f),
            Self::InvalidCronJob(error) => Display::fmt(error, f),
        }
    }
}

impl Error for RuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Host(error) => Some(error),
            Self::InvalidCronJob(error) => Some(error),
        }
    }
}

impl From<HostFailure> for RuntimeError {
    fn from(value: HostFailure) -> Self {
        Self::Host(value)
    }
}

/// Shared runtime result type.
pub type RuntimeResult<T> = Result<T, RuntimeError>;

/// Summary of one orchestrated run through the gateway runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeReport {
    pub conversation_key: ConversationKey,
    pub response_text: String,
    pub delivered: bool,
    pub recorded_at_ms: u64,
}

/// Orchestrates pure gateway plans against host capabilities.
#[derive(Debug)]
pub struct GatewayRuntime<Store, Opencode, Transport, Clock, Logger> {
    engine: GatewayEngine,
    store: Store,
    opencode: Opencode,
    transport: Transport,
    clock: Clock,
    logger: Logger,
}

impl<Store, Opencode, Transport, Clock, Logger>
    GatewayRuntime<Store, Opencode, Transport, Clock, Logger>
where
    Store: HostStore,
    Opencode: HostOpencode,
    Transport: HostTransport,
    Clock: HostClock,
    Logger: HostLogger,
{
    /// Creates a new runtime from the pure engine and host capabilities.
    pub fn new(
        engine: GatewayEngine,
        store: Store,
        opencode: Opencode,
        transport: Transport,
        clock: Clock,
        logger: Logger,
    ) -> Self {
        Self {
            engine,
            store,
            opencode,
            transport,
            clock,
            logger,
        }
    }

    /// Returns the current pure engine status snapshot.
    pub fn status(&self) -> &GatewayStatus {
        self.engine.status()
    }

    /// Handles one inbound IM message by planning, executing, and optionally replying.
    ///
    /// # Errors
    ///
    /// Returns a [`RuntimeError`] when host persistence, prompt execution, or delivery fails.
    pub async fn handle_inbound_message(
        &self,
        message: InboundMessage,
    ) -> RuntimeResult<RuntimeReport> {
        let recorded_at_ms = self.clock.now_unix_ms();
        self.logger
            .log(LogLevel::Info, "handling inbound gateway message");
        self.store
            .record_inbound_message(&message, recorded_at_ms)
            .await?;

        let plan = self.engine.plan_inbound_message(&message);
        self.execute_plan(plan, recorded_at_ms).await
    }

    /// Dispatches one cron job by validating it, executing the prompt, and recording the run.
    ///
    /// # Errors
    ///
    /// Returns a [`RuntimeError`] when cron validation fails or host execution cannot complete.
    pub async fn dispatch_cron_job(&self, job: &CronJobSpec) -> RuntimeResult<RuntimeReport> {
        let recorded_at_ms = self.clock.now_unix_ms();
        self.logger
            .log(LogLevel::Info, "dispatching cron gateway job");
        self.store.record_cron_dispatch(job, recorded_at_ms).await?;

        let plan = self
            .engine
            .plan_cron_job(job)
            .map_err(RuntimeError::InvalidCronJob)?;

        self.execute_plan(plan, recorded_at_ms).await
    }

    async fn execute_plan(
        &self,
        plan: GatewayPlan,
        recorded_at_ms: u64,
    ) -> RuntimeResult<RuntimeReport> {
        let response_text = self.opencode.run_prompt(&plan.request).await?;
        let delivered = if let Some(message) = plan.to_outbound_message(response_text.clone()) {
            self.transport.send_message(&message).await?;
            self.store.record_delivery(&message, recorded_at_ms).await?;
            true
        } else {
            false
        };

        Ok(RuntimeReport {
            conversation_key: plan.request.conversation_key,
            response_text,
            delivered,
            recorded_at_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use pollster::block_on;
    use std::sync::Mutex;

    use opencode_gateway_core::{
        ChannelKind, CronJobSpec, GatewayEngine, InboundMessage, OutboundMessage, PromptRequest,
        TargetKey,
    };

    use crate::host::{
        HostClock, HostLogger, HostOpencode, HostResult, HostStore, HostTransport, LogLevel,
    };
    use crate::{GatewayRuntime, RuntimeResult};

    #[derive(Debug, Default)]
    struct MockStore {
        events: Mutex<Vec<String>>,
    }

    impl HostStore for MockStore {
        async fn record_inbound_message(
            &self,
            message: &InboundMessage,
            recorded_at_ms: u64,
        ) -> HostResult<()> {
            self.events
                .lock()
                .expect("store lock")
                .push(format!("inbound:{}:{recorded_at_ms}", message.body));
            Ok(())
        }

        async fn record_cron_dispatch(
            &self,
            job: &CronJobSpec,
            recorded_at_ms: u64,
        ) -> HostResult<()> {
            self.events
                .lock()
                .expect("store lock")
                .push(format!("cron:{}:{recorded_at_ms}", job.id.as_str()));
            Ok(())
        }

        async fn record_delivery(
            &self,
            message: &OutboundMessage,
            recorded_at_ms: u64,
        ) -> HostResult<()> {
            self.events.lock().expect("store lock").push(format!(
                "delivery:{}:{}:{recorded_at_ms}",
                message.delivery_target.target.as_str(),
                message.body
            ));
            Ok(())
        }
    }

    #[derive(Debug)]
    struct MockOpencode {
        response_text: String,
        prompts: Mutex<Vec<String>>,
    }

    impl HostOpencode for MockOpencode {
        async fn run_prompt(&self, request: &PromptRequest) -> HostResult<String> {
            self.prompts
                .lock()
                .expect("prompt lock")
                .push(request.prompt.clone());
            Ok(self.response_text.clone())
        }
    }

    #[derive(Debug, Default)]
    struct MockTransport {
        messages: Mutex<Vec<OutboundMessage>>,
    }

    impl HostTransport for MockTransport {
        async fn send_message(&self, message: &OutboundMessage) -> HostResult<()> {
            self.messages
                .lock()
                .expect("transport lock")
                .push(message.clone());
            Ok(())
        }
    }

    #[derive(Debug)]
    struct MockClock {
        now_unix_ms: u64,
    }

    impl HostClock for MockClock {
        fn now_unix_ms(&self) -> u64 {
            self.now_unix_ms
        }
    }

    #[derive(Debug, Default)]
    struct MockLogger {
        entries: Mutex<Vec<String>>,
    }

    impl HostLogger for MockLogger {
        fn log(&self, level: LogLevel, message: &str) {
            self.entries
                .lock()
                .expect("logger lock")
                .push(format!("{level:?}:{message}"));
        }
    }

    fn build_runtime(
        response_text: &str,
    ) -> GatewayRuntime<MockStore, MockOpencode, MockTransport, MockClock, MockLogger> {
        GatewayRuntime::new(
            GatewayEngine::new(),
            MockStore::default(),
            MockOpencode {
                response_text: response_text.to_owned(),
                prompts: Mutex::default(),
            },
            MockTransport::default(),
            MockClock { now_unix_ms: 4242 },
            MockLogger::default(),
        )
    }

    #[test]
    fn inbound_message_executes_and_delivers() -> RuntimeResult<()> {
        let runtime = build_runtime("assistant reply");
        let target = TargetKey::new("123").expect("target key");
        let inbound =
            InboundMessage::new(ChannelKind::Telegram, target, None, "alice", "hello world")
                .expect("inbound message");

        let report = block_on(runtime.handle_inbound_message(inbound))?;

        assert_eq!(report.conversation_key.as_str(), "telegram:123");
        assert_eq!(report.response_text, "assistant reply");
        assert!(report.delivered);

        Ok(())
    }

    #[test]
    fn cron_dispatch_executes_without_delivery() -> RuntimeResult<()> {
        let runtime = build_runtime("nightly summary");
        let job =
            CronJobSpec::new("nightly", "0 0 * * *", "Summarize work").expect("cron job spec");

        let report = block_on(runtime.dispatch_cron_job(&job))?;

        assert_eq!(report.conversation_key.as_str(), "cron:nightly");
        assert_eq!(report.response_text, "nightly summary");
        assert!(!report.delivered);

        Ok(())
    }
}
