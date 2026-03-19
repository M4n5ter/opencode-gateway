//! `OpenCode` execution capability contract.

use opencode_gateway_core::{ConversationKey, PromptRequest};

use crate::host::HostResult;

/// The host-side prompt execution request including an optional persisted session binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodePromptRequest {
    pub conversation_key: ConversationKey,
    pub prompt: String,
    pub session_id: Option<String>,
}

impl OpencodePromptRequest {
    /// Creates a prompt execution request from the pure gateway prompt and a persisted session id.
    pub fn new(request: &PromptRequest, session_id: Option<String>) -> Self {
        Self {
            conversation_key: request.conversation_key.clone(),
            prompt: request.prompt.clone(),
            session_id,
        }
    }
}

/// The host-side prompt execution result with the effective session id and final text response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodePromptResult {
    pub session_id: String,
    pub response_text: String,
}

impl OpencodePromptResult {
    /// Creates a prompt execution result.
    pub fn new(session_id: impl Into<String>, response_text: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            response_text: response_text.into(),
        }
    }
}

/// Host capability for executing `OpenCode` prompts.
pub trait HostOpencode: Send + Sync {
    /// Runs a prompt against the host `OpenCode` runtime and returns the effective session id and final response text.
    async fn run_prompt(&self, request: &OpencodePromptRequest)
    -> HostResult<OpencodePromptResult>;
}
