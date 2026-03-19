//! Persistence bookkeeping capability contract.

use opencode_gateway_core::{ConversationKey, CronJobSpec, InboundMessage, OutboundMessage};

use crate::host::HostResult;

/// Host capability for recording runtime activity.
pub trait HostStore: Send + Sync {
    /// Returns the persisted `OpenCode` session id for the logical conversation, if one exists.
    async fn get_session_binding(
        &self,
        conversation_key: &ConversationKey,
    ) -> HostResult<Option<String>>;

    /// Persists the latest `OpenCode` session id for the logical conversation.
    async fn put_session_binding(
        &self,
        conversation_key: &ConversationKey,
        session_id: &str,
        recorded_at_ms: u64,
    ) -> HostResult<()>;

    /// Records that an inbound message entered the runtime.
    async fn record_inbound_message(
        &self,
        message: &InboundMessage,
        recorded_at_ms: u64,
    ) -> HostResult<()>;

    /// Records that a cron dispatch was triggered.
    async fn record_cron_dispatch(&self, job: &CronJobSpec, recorded_at_ms: u64) -> HostResult<()>;

    /// Records that an outbound delivery was attempted.
    async fn record_delivery(
        &self,
        message: &OutboundMessage,
        recorded_at_ms: u64,
    ) -> HostResult<()>;
}
