//! Shared host-side error types.

use std::error::Error;
use std::fmt::{Display, Formatter};

/// Host subsystems that can fail while the runtime is orchestrating a plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostSubsystem {
    Store,
    Opencode,
    Transport,
}

/// Canonical host failure used by the runtime to avoid ad-hoc `String` errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostFailure {
    pub subsystem: HostSubsystem,
    pub message: String,
}

impl HostFailure {
    /// Creates a new host failure with a stable subsystem label.
    pub fn new(subsystem: HostSubsystem, message: impl Into<String>) -> Self {
        Self {
            subsystem,
            message: message.into(),
        }
    }
}

impl Display for HostFailure {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} host failure: {}", self.subsystem, self.message)
    }
}

impl Error for HostFailure {}

/// Shared result type for host capability traits.
pub type HostResult<T> = Result<T, HostFailure>;
