use opencode_gateway_core::{ExecutionObservation, ProgressiveDirective};
use serde::{Deserialize, Serialize};

use super::{normalize_optional_identifier, parse_execution_role, parse_required};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BindingExecutionObservation {
    MessageUpdated {
        session_id: String,
        message_id: String,
        role: String,
        parent_id: Option<String>,
    },
    TextPartUpdated {
        session_id: String,
        message_id: String,
        part_id: String,
        text: Option<String>,
        delta: Option<String>,
        ignored: bool,
    },
    TextPartDelta {
        message_id: String,
        part_id: String,
        delta: String,
    },
}

impl TryFrom<BindingExecutionObservation> for ExecutionObservation {
    type Error = String;

    fn try_from(value: BindingExecutionObservation) -> Result<Self, Self::Error> {
        match value {
            BindingExecutionObservation::MessageUpdated {
                session_id,
                message_id,
                role,
                parent_id,
            } => Ok(Self::MessageUpdated {
                session_id: parse_required(session_id, "execution sessionId")?,
                message_id: parse_required(message_id, "execution messageId")?,
                role: parse_execution_role(role),
                parent_id: normalize_optional_identifier(parent_id),
            }),
            BindingExecutionObservation::TextPartUpdated {
                session_id,
                message_id,
                part_id,
                text,
                delta,
                ignored,
            } => Ok(Self::TextPartUpdated {
                session_id: parse_required(session_id, "execution sessionId")?,
                message_id: parse_required(message_id, "execution messageId")?,
                part_id: parse_required(part_id, "execution partId")?,
                text,
                delta,
                ignored,
            }),
            BindingExecutionObservation::TextPartDelta {
                message_id,
                part_id,
                delta,
            } => Ok(Self::TextPartDelta {
                message_id: parse_required(message_id, "execution messageId")?,
                part_id: parse_required(part_id, "execution partId")?,
                delta,
            }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingProgressiveDirective {
    pub kind: String,
    pub text: Option<String>,
}

impl BindingProgressiveDirective {
    pub fn noop() -> Self {
        Self {
            kind: "noop".to_owned(),
            text: None,
        }
    }
}

impl From<ProgressiveDirective> for BindingProgressiveDirective {
    fn from(value: ProgressiveDirective) -> Self {
        match value {
            ProgressiveDirective::Noop => Self::noop(),
            ProgressiveDirective::Preview(text) => Self {
                kind: "preview".to_owned(),
                text: Some(text),
            },
            ProgressiveDirective::Final(text) => Self {
                kind: "final".to_owned(),
                text: Some(text),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::BindingExecutionObservation;

    #[test]
    fn binding_execution_observation_accepts_camel_case_variant_fields() {
        let observation: BindingExecutionObservation = serde_json::from_value(json!({
            "kind": "messageUpdated",
            "sessionId": "ses_1",
            "messageId": "msg_1",
            "role": "assistant",
            "parentId": "msg_user_1",
        }))
        .expect("observation");

        assert!(matches!(
            observation,
            BindingExecutionObservation::MessageUpdated {
                session_id,
                message_id,
                role,
                parent_id,
            } if session_id == "ses_1"
                && message_id == "msg_1"
                && role == "assistant"
                && parent_id.as_deref() == Some("msg_user_1")
        ));
    }

    #[test]
    fn binding_execution_observation_preserves_whitespace_deltas() {
        let observation: BindingExecutionObservation = serde_json::from_value(json!({
            "kind": "textPartDelta",
            "messageId": "msg_1",
            "partId": "part_1",
            "delta": " ",
        }))
        .expect("observation");

        assert!(matches!(
            observation,
            BindingExecutionObservation::TextPartDelta {
                message_id,
                part_id,
                delta,
            } if message_id == "msg_1" && part_id == "part_1" && delta == " "
        ));
    }
}
