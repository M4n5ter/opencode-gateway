//! Outbound transport capability contract.

use opencode_gateway_core::OutboundMessage;

use crate::host::HostResult;

/// Host capability for sending messages to external IM platforms.
pub trait HostTransport: Send + Sync {
    /// Sends an outbound message to the target IM platform.
    async fn send_message(&self, message: &OutboundMessage) -> HostResult<()>;
}
