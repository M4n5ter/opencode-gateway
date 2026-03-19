//! BoltFFI callback traits implemented on the TypeScript host side.

use boltffi::export;

use crate::binding::{
    BindingCronJobSpec, BindingInboundMessage, BindingOutboundMessage, BindingPromptRequest,
    BindingPromptResult,
};

#[export]
#[async_trait::async_trait]
pub trait BindingStoreHost: Send + Sync {
    async fn get_session_binding(&self, conversation_key: String) -> Option<String>;
    async fn put_session_binding(
        &self,
        conversation_key: String,
        session_id: String,
        recorded_at_ms: u64,
    );
    async fn record_inbound_message(&self, message: BindingInboundMessage, recorded_at_ms: u64);
    async fn record_cron_dispatch(&self, job: BindingCronJobSpec, recorded_at_ms: u64);
    async fn record_delivery(&self, message: BindingOutboundMessage, recorded_at_ms: u64);
}

#[export]
#[async_trait::async_trait]
pub trait BindingOpencodeHost: Send + Sync {
    async fn run_prompt(&self, request: BindingPromptRequest) -> BindingPromptResult;
}

#[export]
#[async_trait::async_trait]
pub trait BindingTransportHost: Send + Sync {
    async fn send_message(&self, message: BindingOutboundMessage);
}

#[export]
pub trait BindingClockHost: Send + Sync {
    fn now_unix_ms(&self) -> u64;
}

#[export]
pub trait BindingLoggerHost: Send + Sync {
    fn log(&self, level: String, message: String);
}
