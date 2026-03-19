//! `OpenCode` execution capability contract.

use opencode_gateway_core::PromptRequest;

use crate::host::HostResult;

/// Host capability for executing `OpenCode` prompts.
pub trait HostOpencode: Send + Sync {
    /// Runs a prompt against the host `OpenCode` runtime and returns the final response text.
    async fn run_prompt(&self, request: &PromptRequest) -> HostResult<String>;
}
