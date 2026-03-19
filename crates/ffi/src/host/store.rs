//! Persistence bookkeeping capability contract.

use opencode_gateway_core::{CronJobSpec, InboundMessage, OutboundMessage};

use crate::host::HostResult;

/// Host capability for recording runtime activity.
pub trait HostStore: Send + Sync {
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
