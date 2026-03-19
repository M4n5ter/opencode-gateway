//! Logging capability contract.

/// Minimal log levels exposed by the runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// Host-provided logger used by the runtime for operational breadcrumbs.
pub trait HostLogger: Send + Sync {
    /// Emits a structured runtime log line.
    fn log(&self, level: LogLevel, message: &str);
}
