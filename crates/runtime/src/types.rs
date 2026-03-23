//! Typed commands and results for OpenCode execution hosts.

use opencode_gateway_core::ProgressiveMode;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodePrompt {
    pub prompt_key: String,
    pub prompt: String,
}

impl OpencodePrompt {
    pub fn new(prompt_key: impl Into<String>, prompt: impl Into<String>) -> Result<Self, String> {
        let prompt_key = parse_required(prompt_key.into(), "promptKey")?;
        Ok(Self {
            prompt_key,
            prompt: prompt.into(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodeMessagePart {
    pub message_id: String,
    pub part_id: String,
    pub kind: String,
    pub text: Option<String>,
    pub ignored: bool,
}

impl OpencodeMessagePart {
    pub fn new(
        message_id: impl Into<String>,
        part_id: impl Into<String>,
        kind: impl Into<String>,
        text: Option<String>,
        ignored: bool,
    ) -> Result<Self, String> {
        Ok(Self {
            message_id: parse_required(message_id.into(), "messagePart messageId")?,
            part_id: parse_required(part_id.into(), "messagePart partId")?,
            kind: parse_required(kind.into(), "messagePart type")?,
            text,
            ignored,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodeMessage {
    pub message_id: String,
    pub role: String,
    pub parent_id: Option<String>,
    pub parts: Vec<OpencodeMessagePart>,
}

impl OpencodeMessage {
    pub fn new(
        message_id: impl Into<String>,
        role: impl Into<String>,
        parent_id: Option<String>,
        parts: Vec<OpencodeMessagePart>,
    ) -> Result<Self, String> {
        Ok(Self {
            message_id: parse_required(message_id.into(), "message messageId")?,
            role: parse_required(role.into(), "message role")?,
            parent_id,
            parts,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodeExecutionInput {
    pub conversation_key: String,
    pub persisted_session_id: Option<String>,
    pub mode: ProgressiveMode,
    pub flush_interval_ms: u64,
    pub prompts: Vec<OpencodePrompt>,
}

impl OpencodeExecutionInput {
    pub fn new(
        conversation_key: impl Into<String>,
        persisted_session_id: Option<String>,
        mode: ProgressiveMode,
        flush_interval_ms: u64,
        prompts: Vec<OpencodePrompt>,
    ) -> Result<Self, String> {
        let conversation_key = parse_required(conversation_key.into(), "conversationKey")?;
        let persisted_session_id = persisted_session_id
            .map(|value| parse_required(value, "persistedSessionId"))
            .transpose()?;

        if prompts.is_empty() {
            return Err("opencode execution requires at least one prompt".to_owned());
        }

        Ok(Self {
            conversation_key,
            persisted_session_id,
            mode,
            flush_interval_ms,
            prompts,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpencodeCommand {
    LookupSession {
        session_id: String,
    },
    CreateSession {
        title: String,
    },
    WaitUntilIdle {
        session_id: String,
    },
    AppendPrompt {
        session_id: String,
        message_id: String,
        text_part_id: String,
        prompt: String,
    },
    SendPromptAsync {
        session_id: String,
        message_id: String,
        text_part_id: String,
        prompt: String,
    },
    AwaitPromptResponse {
        session_id: String,
        message_id: String,
    },
    ReadMessage {
        session_id: String,
        message_id: String,
    },
    ListMessages {
        session_id: String,
    },
}

impl OpencodeCommand {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::LookupSession { .. } => "lookupSession",
            Self::CreateSession { .. } => "createSession",
            Self::WaitUntilIdle { .. } => "waitUntilIdle",
            Self::AppendPrompt { .. } => "appendPrompt",
            Self::SendPromptAsync { .. } => "sendPromptAsync",
            Self::AwaitPromptResponse { .. } => "awaitPromptResponse",
            Self::ReadMessage { .. } => "readMessage",
            Self::ListMessages { .. } => "listMessages",
        }
    }

    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::LookupSession { session_id }
            | Self::WaitUntilIdle { session_id }
            | Self::AppendPrompt { session_id, .. }
            | Self::SendPromptAsync { session_id, .. }
            | Self::AwaitPromptResponse { session_id, .. }
            | Self::ReadMessage { session_id, .. }
            | Self::ListMessages { session_id } => Some(session_id.as_str()),
            Self::CreateSession { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpencodeCommandErrorCode {
    MissingSession,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpencodeCommandError {
    pub command_kind: String,
    pub session_id: Option<String>,
    pub code: OpencodeCommandErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpencodeCommandResult {
    LookupSession {
        session_id: String,
        found: bool,
    },
    CreateSession {
        session_id: String,
    },
    WaitUntilIdle {
        session_id: String,
    },
    AppendPrompt {
        session_id: String,
    },
    SendPromptAsync {
        session_id: String,
    },
    AwaitPromptResponse {
        session_id: String,
        message_id: String,
        parts: Vec<OpencodeMessagePart>,
    },
    ReadMessage {
        session_id: String,
        message_id: String,
        parts: Vec<OpencodeMessagePart>,
    },
    ListMessages {
        session_id: String,
        messages: Vec<OpencodeMessage>,
    },
    Error(OpencodeCommandError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpencodeDriverStep {
    Command(OpencodeCommand),
    Complete {
        session_id: String,
        response_text: String,
        final_text: Option<String>,
    },
    Failed {
        message: String,
    },
}

pub(crate) fn parse_required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed.to_owned())
}
