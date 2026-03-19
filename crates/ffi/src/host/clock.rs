//! Clock capability contract.

/// Host-provided time source used by the runtime for stable bookkeeping.
pub trait HostClock: Send + Sync {
    /// Returns the current Unix timestamp in milliseconds.
    fn now_unix_ms(&self) -> u64;
}
