use opencode_gateway_runtime::{
    OpencodeCommand, OpencodeCommandError, OpencodeCommandPart, OpencodeCommandResult,
    OpencodeDriverStep, OpencodeExecutionInput, OpencodeMessage, OpencodeMessagePart,
    OpencodePrompt, OpencodePromptPart,
};
use serde::{Deserialize, Serialize};

use super::{
    gateway::BindingPromptPart, parse_command_error_code, parse_progressive_mode, parse_required,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingOpencodePrompt {
    pub prompt_key: String,
    pub parts: Vec<BindingPromptPart>,
}

impl TryFrom<BindingOpencodePrompt> for OpencodePrompt {
    type Error = String;

    fn try_from(value: BindingOpencodePrompt) -> Result<Self, Self::Error> {
        OpencodePrompt::new(
            value.prompt_key,
            value
                .parts
                .into_iter()
                .map(opencode_prompt_part_from_binding)
                .collect::<Result<Vec<_>, _>>()?,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingOpencodeCommandPart {
    Text {
        part_id: String,
        text: String,
    },
    File {
        part_id: String,
        mime_type: String,
        file_name: Option<String>,
        local_path: String,
    },
}

impl TryFrom<BindingOpencodeCommandPart> for OpencodeCommandPart {
    type Error = String;

    fn try_from(value: BindingOpencodeCommandPart) -> Result<Self, Self::Error> {
        match value {
            BindingOpencodeCommandPart::Text { part_id, text } => {
                OpencodeCommandPart::text(part_id, text)
            }
            BindingOpencodeCommandPart::File {
                part_id,
                mime_type,
                file_name,
                local_path,
            } => OpencodeCommandPart::file(part_id, mime_type, file_name, local_path),
        }
    }
}

impl From<OpencodeCommandPart> for BindingOpencodeCommandPart {
    fn from(value: OpencodeCommandPart) -> Self {
        match value {
            OpencodeCommandPart::Text { part_id, text } => Self::Text { part_id, text },
            OpencodeCommandPart::File {
                part_id,
                mime_type,
                file_name,
                local_path,
            } => Self::File {
                part_id,
                mime_type,
                file_name,
                local_path,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingOpencodeMessagePart {
    pub message_id: String,
    pub part_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub text: Option<String>,
    pub ignored: bool,
}

impl TryFrom<BindingOpencodeMessagePart> for OpencodeMessagePart {
    type Error = String;

    fn try_from(value: BindingOpencodeMessagePart) -> Result<Self, Self::Error> {
        OpencodeMessagePart::new(
            value.message_id,
            value.part_id,
            value.kind,
            value.text,
            value.ignored,
        )
    }
}

impl From<OpencodeMessagePart> for BindingOpencodeMessagePart {
    fn from(value: OpencodeMessagePart) -> Self {
        Self {
            message_id: value.message_id,
            part_id: value.part_id,
            kind: value.kind,
            text: value.text,
            ignored: value.ignored,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingOpencodeMessage {
    pub message_id: String,
    pub role: String,
    pub parent_id: Option<String>,
    pub parts: Vec<BindingOpencodeMessagePart>,
}

impl TryFrom<BindingOpencodeMessage> for OpencodeMessage {
    type Error = String;

    fn try_from(value: BindingOpencodeMessage) -> Result<Self, Self::Error> {
        OpencodeMessage::new(
            value.message_id,
            value.role,
            value.parent_id,
            value
                .parts
                .into_iter()
                .map(OpencodeMessagePart::try_from)
                .collect::<Result<Vec<_>, _>>()?,
        )
    }
}

impl From<OpencodeMessage> for BindingOpencodeMessage {
    fn from(value: OpencodeMessage) -> Self {
        Self {
            message_id: value.message_id,
            role: value.role,
            parent_id: value.parent_id,
            parts: value
                .parts
                .into_iter()
                .map(BindingOpencodeMessagePart::from)
                .collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingOpencodeExecutionInput {
    pub conversation_key: String,
    pub persisted_session_id: Option<String>,
    pub mode: String,
    pub flush_interval_ms: u32,
    pub prompts: Vec<BindingOpencodePrompt>,
}

impl TryFrom<BindingOpencodeExecutionInput> for OpencodeExecutionInput {
    type Error = String;

    fn try_from(value: BindingOpencodeExecutionInput) -> Result<Self, Self::Error> {
        let mode = parse_progressive_mode(&value.mode)?;
        let prompts = value
            .prompts
            .into_iter()
            .map(OpencodePrompt::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        OpencodeExecutionInput::new(
            value.conversation_key,
            value.persisted_session_id,
            mode,
            u64::from(value.flush_interval_ms),
            prompts,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingOpencodeCommand {
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
        parts: Vec<BindingOpencodeCommandPart>,
    },
    SendPromptAsync {
        session_id: String,
        message_id: String,
        parts: Vec<BindingOpencodeCommandPart>,
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

impl From<OpencodeCommand> for BindingOpencodeCommand {
    fn from(value: OpencodeCommand) -> Self {
        match value {
            OpencodeCommand::LookupSession { session_id } => Self::LookupSession { session_id },
            OpencodeCommand::CreateSession { title } => Self::CreateSession { title },
            OpencodeCommand::WaitUntilIdle { session_id } => Self::WaitUntilIdle { session_id },
            OpencodeCommand::AppendPrompt {
                session_id,
                message_id,
                parts,
            } => Self::AppendPrompt {
                session_id,
                message_id,
                parts: parts
                    .into_iter()
                    .map(BindingOpencodeCommandPart::from)
                    .collect(),
            },
            OpencodeCommand::SendPromptAsync {
                session_id,
                message_id,
                parts,
            } => Self::SendPromptAsync {
                session_id,
                message_id,
                parts: parts
                    .into_iter()
                    .map(BindingOpencodeCommandPart::from)
                    .collect(),
            },
            OpencodeCommand::AwaitPromptResponse {
                session_id,
                message_id,
            } => Self::AwaitPromptResponse {
                session_id,
                message_id,
            },
            OpencodeCommand::ReadMessage {
                session_id,
                message_id,
            } => Self::ReadMessage {
                session_id,
                message_id,
            },
            OpencodeCommand::ListMessages { session_id } => Self::ListMessages { session_id },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingOpencodeCommandResult {
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
        parts: Vec<BindingOpencodeMessagePart>,
    },
    ReadMessage {
        session_id: String,
        message_id: String,
        parts: Vec<BindingOpencodeMessagePart>,
    },
    ListMessages {
        session_id: String,
        messages: Vec<BindingOpencodeMessage>,
    },
    Error {
        command_kind: String,
        session_id: Option<String>,
        code: String,
        message: String,
    },
}

impl TryFrom<BindingOpencodeCommandResult> for OpencodeCommandResult {
    type Error = String;

    fn try_from(value: BindingOpencodeCommandResult) -> Result<Self, String> {
        Ok(match value {
            BindingOpencodeCommandResult::LookupSession { session_id, found } => {
                Self::LookupSession {
                    session_id: parse_required(session_id, "commandResult sessionId")?,
                    found,
                }
            }
            BindingOpencodeCommandResult::CreateSession { session_id } => Self::CreateSession {
                session_id: parse_required(session_id, "commandResult sessionId")?,
            },
            BindingOpencodeCommandResult::WaitUntilIdle { session_id } => Self::WaitUntilIdle {
                session_id: parse_required(session_id, "commandResult sessionId")?,
            },
            BindingOpencodeCommandResult::AppendPrompt { session_id } => Self::AppendPrompt {
                session_id: parse_required(session_id, "commandResult sessionId")?,
            },
            BindingOpencodeCommandResult::SendPromptAsync { session_id } => Self::SendPromptAsync {
                session_id: parse_required(session_id, "commandResult sessionId")?,
            },
            BindingOpencodeCommandResult::AwaitPromptResponse {
                session_id,
                message_id,
                parts,
            } => Self::AwaitPromptResponse {
                session_id: parse_required(session_id, "commandResult sessionId")?,
                message_id: parse_required(message_id, "commandResult messageId")?,
                parts: parts
                    .into_iter()
                    .map(OpencodeMessagePart::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            },
            BindingOpencodeCommandResult::ReadMessage {
                session_id,
                message_id,
                parts,
            } => Self::ReadMessage {
                session_id: parse_required(session_id, "commandResult sessionId")?,
                message_id: parse_required(message_id, "commandResult messageId")?,
                parts: parts
                    .into_iter()
                    .map(OpencodeMessagePart::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            },
            BindingOpencodeCommandResult::ListMessages {
                session_id,
                messages,
            } => Self::ListMessages {
                session_id: parse_required(session_id, "commandResult sessionId")?,
                messages: messages
                    .into_iter()
                    .map(OpencodeMessage::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            },
            BindingOpencodeCommandResult::Error {
                command_kind,
                session_id,
                code,
                message,
            } => Self::Error(OpencodeCommandError {
                command_kind: parse_required(command_kind, "commandResult commandKind")?,
                session_id: session_id
                    .map(|value| parse_required(value, "commandResult sessionId"))
                    .transpose()?,
                code: parse_command_error_code(&code)?,
                message: parse_required(message, "commandResult message")?,
            }),
        })
    }
}

fn opencode_prompt_part_from_binding(
    value: BindingPromptPart,
) -> Result<OpencodePromptPart, String> {
    match value {
        BindingPromptPart::Text { text } => OpencodePromptPart::text(text),
        BindingPromptPart::File {
            mime_type,
            file_name,
            local_path,
        } => OpencodePromptPart::file(mime_type, file_name, local_path),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingOpencodeDriverStep {
    Command {
        command: BindingOpencodeCommand,
    },
    Complete {
        session_id: String,
        response_text: String,
        final_text: Option<String>,
    },
    Failed {
        message: String,
    },
}

impl From<OpencodeDriverStep> for BindingOpencodeDriverStep {
    fn from(value: OpencodeDriverStep) -> Self {
        match value {
            OpencodeDriverStep::Command(command) => Self::Command {
                command: BindingOpencodeCommand::from(command),
            },
            OpencodeDriverStep::Complete {
                session_id,
                response_text,
                final_text,
            } => Self::Complete {
                session_id,
                response_text,
                final_text,
            },
            OpencodeDriverStep::Failed { message } => Self::Failed { message },
        }
    }
}
