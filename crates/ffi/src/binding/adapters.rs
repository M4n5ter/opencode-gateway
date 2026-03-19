//! Adapters from BoltFFI callback traits to internal host traits.

use std::sync::Arc;

use opencode_gateway_core::{CronJobSpec, InboundMessage, OutboundMessage, PromptRequest};

use crate::binding::{
    BindingClockHost, BindingCronJobSpec, BindingInboundMessage, BindingLoggerHost,
    BindingOpencodeHost, BindingOutboundMessage, BindingPromptRequest, BindingStoreHost,
    BindingTransportHost,
};
use crate::{HostClock, HostLogger, HostOpencode, HostResult, HostStore, HostTransport, LogLevel};

pub type CallbackRuntime = crate::GatewayRuntime<
    StoreCallbackAdapter,
    OpencodeCallbackAdapter,
    TransportCallbackAdapter,
    ClockCallbackAdapter,
    LoggerCallbackAdapter,
>;

pub struct StoreCallbackAdapter {
    inner: Arc<dyn BindingStoreHost>,
}

impl StoreCallbackAdapter {
    pub fn new(inner: Arc<dyn BindingStoreHost>) -> Self {
        Self { inner }
    }
}

impl HostStore for StoreCallbackAdapter {
    async fn record_inbound_message(
        &self,
        message: &InboundMessage,
        recorded_at_ms: u64,
    ) -> HostResult<()> {
        self.inner
            .record_inbound_message(BindingInboundMessage::from(message), recorded_at_ms)
            .await;
        Ok(())
    }

    async fn record_cron_dispatch(&self, job: &CronJobSpec, recorded_at_ms: u64) -> HostResult<()> {
        self.inner
            .record_cron_dispatch(
                BindingCronJobSpec {
                    id: job.id.as_str().to_owned(),
                    schedule: job.schedule.clone(),
                    prompt: job.prompt.clone(),
                },
                recorded_at_ms,
            )
            .await;
        Ok(())
    }

    async fn record_delivery(
        &self,
        message: &OutboundMessage,
        recorded_at_ms: u64,
    ) -> HostResult<()> {
        self.inner
            .record_delivery(BindingOutboundMessage::from(message), recorded_at_ms)
            .await;
        Ok(())
    }
}

pub struct OpencodeCallbackAdapter {
    inner: Arc<dyn BindingOpencodeHost>,
}

impl OpencodeCallbackAdapter {
    pub fn new(inner: Arc<dyn BindingOpencodeHost>) -> Self {
        Self { inner }
    }
}

impl HostOpencode for OpencodeCallbackAdapter {
    async fn run_prompt(&self, request: &PromptRequest) -> HostResult<String> {
        Ok(self
            .inner
            .run_prompt(BindingPromptRequest::from(request))
            .await)
    }
}

pub struct TransportCallbackAdapter {
    inner: Arc<dyn BindingTransportHost>,
}

impl TransportCallbackAdapter {
    pub fn new(inner: Arc<dyn BindingTransportHost>) -> Self {
        Self { inner }
    }
}

impl HostTransport for TransportCallbackAdapter {
    async fn send_message(&self, message: &OutboundMessage) -> HostResult<()> {
        self.inner
            .send_message(BindingOutboundMessage::from(message))
            .await;
        Ok(())
    }
}

pub struct ClockCallbackAdapter {
    inner: Arc<dyn BindingClockHost>,
}

impl ClockCallbackAdapter {
    pub fn new(inner: Arc<dyn BindingClockHost>) -> Self {
        Self { inner }
    }
}

impl HostClock for ClockCallbackAdapter {
    fn now_unix_ms(&self) -> u64 {
        self.inner.now_unix_ms()
    }
}

pub struct LoggerCallbackAdapter {
    inner: Arc<dyn BindingLoggerHost>,
}

impl LoggerCallbackAdapter {
    pub fn new(inner: Arc<dyn BindingLoggerHost>) -> Self {
        Self { inner }
    }
}

impl HostLogger for LoggerCallbackAdapter {
    fn log(&self, level: LogLevel, message: &str) {
        self.inner.log(log_level_label(level), message.to_owned());
    }
}

pub fn runtime_from_callbacks(
    store: Arc<dyn BindingStoreHost>,
    opencode: Arc<dyn BindingOpencodeHost>,
    transport: Arc<dyn BindingTransportHost>,
    clock: Arc<dyn BindingClockHost>,
    logger: Arc<dyn BindingLoggerHost>,
) -> CallbackRuntime {
    crate::GatewayRuntime::new(
        opencode_gateway_core::GatewayEngine::new(),
        StoreCallbackAdapter::new(store),
        OpencodeCallbackAdapter::new(opencode),
        TransportCallbackAdapter::new(transport),
        ClockCallbackAdapter::new(clock),
        LoggerCallbackAdapter::new(logger),
    )
}

fn log_level_label(level: LogLevel) -> String {
    match level {
        LogLevel::Info => "info".to_owned(),
        LogLevel::Warn => "warn".to_owned(),
        LogLevel::Error => "error".to_owned(),
    }
}
