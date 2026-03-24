//! Prepared execution plans and platform-agnostic streaming state.

use std::collections::HashMap;

use crate::{
    CronJobSpec, CronValidationError, DeliveryTarget, GatewayEngine, InboundMessage,
    ProgressiveDirective, ProgressiveMode, ProgressiveTextState, PromptPart,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedExecution {
    pub conversation_key: String,
    pub prompt_parts: Vec<PromptPart>,
    pub reply_target: Option<DeliveryTarget>,
}

impl PreparedExecution {
    pub fn for_inbound_message(message: &InboundMessage) -> Self {
        Self::from_plan(GatewayEngine::new().plan_inbound_message(message))
    }

    pub fn for_cron_job(job: &CronJobSpec) -> Result<Self, CronValidationError> {
        GatewayEngine::new().plan_cron_job(job).map(Self::from_plan)
    }

    fn from_plan(plan: crate::GatewayPlan) -> Self {
        Self {
            conversation_key: plan.request.conversation_key.as_str().to_owned(),
            prompt_parts: plan.request.parts,
            reply_target: plan.reply_target,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionRole {
    User,
    Assistant,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionObservation {
    MessageUpdated {
        session_id: String,
        message_id: String,
        role: ExecutionRole,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionState {
    session_id: String,
    user_message_id: Option<String>,
    assistant_message_id: Option<String>,
    text_parts: HashMap<String, TrackedTextPart>,
    next_order: u64,
    progressive: ProgressiveTextState,
}

impl ExecutionState {
    pub fn new(
        session_id: impl Into<String>,
        mode: ProgressiveMode,
        flush_interval_ms: u64,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            user_message_id: None,
            assistant_message_id: None,
            text_parts: HashMap::new(),
            next_order: 0,
            progressive: ProgressiveTextState::new(mode, flush_interval_ms),
        }
    }

    pub fn observe(
        &mut self,
        observation: ExecutionObservation,
        now_ms: u64,
    ) -> ProgressiveDirective {
        match observation {
            ExecutionObservation::MessageUpdated {
                session_id,
                message_id,
                role,
                parent_id,
            } => self.observe_message_updated(session_id, message_id, role, parent_id),
            ExecutionObservation::TextPartUpdated {
                session_id,
                message_id,
                part_id,
                text,
                delta,
                ignored,
            } => self.observe_text_part(
                session_id, message_id, part_id, text, delta, ignored, now_ms,
            ),
            ExecutionObservation::TextPartDelta {
                message_id,
                part_id,
                delta,
            } => self.observe_text_part_delta(message_id, part_id, delta, now_ms),
        }
    }

    pub fn finish(&mut self, final_text: impl Into<String>, now_ms: u64) -> ProgressiveDirective {
        self.progressive.finish(final_text, now_ms)
    }

    pub fn assistant_message_id(&self) -> Option<&str> {
        self.assistant_message_id.as_deref()
    }

    fn observe_message_updated(
        &mut self,
        session_id: String,
        message_id: String,
        role: ExecutionRole,
        parent_id: Option<String>,
    ) -> ProgressiveDirective {
        if session_id != self.session_id {
            return ProgressiveDirective::Noop;
        }

        match role {
            ExecutionRole::User => {
                self.user_message_id = Some(message_id);
            }
            ExecutionRole::Assistant => {
                if self.user_message_id.is_none()
                    || parent_id.as_deref() != self.user_message_id.as_deref()
                {
                    return ProgressiveDirective::Noop;
                }

                if self.assistant_message_id.as_deref() != Some(message_id.as_str())
                    && !self.has_visible_preview_text()
                {
                    self.text_parts.clear();
                    self.next_order = 0;
                    self.assistant_message_id = Some(message_id.clone());
                }
                if self.assistant_message_id.is_none() {
                    self.assistant_message_id = Some(message_id);
                }
            }
            ExecutionRole::Other(_) => {}
        }

        ProgressiveDirective::Noop
    }

    #[allow(clippy::too_many_arguments)]
    fn observe_text_part(
        &mut self,
        session_id: String,
        message_id: String,
        part_id: String,
        text: Option<String>,
        delta: Option<String>,
        ignored: bool,
        now_ms: u64,
    ) -> ProgressiveDirective {
        if ignored
            || session_id != self.session_id
            || self.assistant_message_id.as_deref() != Some(message_id.as_str())
        {
            return ProgressiveDirective::Noop;
        }

        let tracked_part = self.text_parts.entry(part_id).or_insert_with(|| {
            TrackedTextPart::new(text.as_deref().unwrap_or(""), self.next_order)
        });
        if tracked_part.order == self.next_order {
            self.next_order = self.next_order.saturating_add(1);
        }

        if let Some(text) = text {
            tracked_part.text = text;
        } else if let Some(delta) = delta.filter(|value| !value.is_empty()) {
            tracked_part.text.push_str(&delta);
        }

        self.progressive
            .observe_snapshot(self.render_snapshot(), now_ms)
    }

    fn observe_text_part_delta(
        &mut self,
        message_id: String,
        part_id: String,
        delta: String,
        now_ms: u64,
    ) -> ProgressiveDirective {
        if delta.is_empty() || self.assistant_message_id.as_deref() != Some(message_id.as_str()) {
            return ProgressiveDirective::Noop;
        }

        let Some(tracked_part) = self.text_parts.get_mut(&part_id) else {
            return ProgressiveDirective::Noop;
        };
        tracked_part.text.push_str(&delta);

        self.progressive
            .observe_snapshot(self.render_snapshot(), now_ms)
    }

    fn render_snapshot(&self) -> String {
        let mut parts = self.text_parts.values().cloned().collect::<Vec<_>>();
        parts.sort_by_key(|part| part.order);

        parts
            .into_iter()
            .map(|part| part.text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn has_visible_preview_text(&self) -> bool {
        self.text_parts
            .values()
            .any(|part| !part.text.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrackedTextPart {
    text: String,
    order: u64,
}

impl TrackedTextPart {
    fn new(text: &str, order: u64) -> Self {
        Self {
            text: text.to_owned(),
            order,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ChannelKind, CronJobSpec, InboundMessage, ProgressiveDirective, ProgressiveMode,
        PromptPart, TargetKey,
    };

    use super::{ExecutionObservation, ExecutionRole, ExecutionState, PreparedExecution};

    #[test]
    fn prepared_execution_for_inbound_uses_conversation_key_and_reply_target() {
        let target = TargetKey::new("42").expect("target");
        let message = InboundMessage::new(
            ChannelKind::Telegram,
            target,
            None,
            "telegram:7",
            Some("hello".to_owned()),
            vec![],
        )
        .expect("message");

        let prepared = PreparedExecution::for_inbound_message(&message);

        assert_eq!(prepared.conversation_key, "telegram:42");
        assert_eq!(
            prepared.prompt_parts,
            vec![PromptPart::Text("hello".to_owned())]
        );
        assert!(prepared.reply_target.is_some());
    }

    #[test]
    fn prepared_execution_for_cron_uses_cron_conversation_key() {
        let job = CronJobSpec::new("nightly", "0 9 * * *", "summarize").expect("job");

        let prepared = PreparedExecution::for_cron_job(&job).expect("prepared");

        assert_eq!(prepared.conversation_key, "cron:nightly");
        assert_eq!(
            prepared.prompt_parts,
            vec![PromptPart::Text("summarize".to_owned())]
        );
        assert!(prepared.reply_target.is_none());
    }

    #[test]
    fn execution_state_binds_assistant_message_and_emits_preview_from_delta() {
        let mut state = ExecutionState::new("ses_1", ProgressiveMode::Progressive, 100);

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_user_1".to_owned(),
                    role: ExecutionRole::User,
                    parent_id: None,
                },
                0,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                1,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    part_id: "part_1".to_owned(),
                    text: None,
                    delta: Some("hel".to_owned()),
                    ignored: false,
                },
                2,
            ),
            ProgressiveDirective::Preview("hel".to_owned())
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartDelta {
                    message_id: "msg_assistant_1".to_owned(),
                    part_id: "part_1".to_owned(),
                    delta: "lo".to_owned(),
                },
                200,
            ),
            ProgressiveDirective::Preview("hello".to_owned())
        );
    }

    #[test]
    fn execution_state_prefers_full_text_when_update_also_contains_delta() {
        let mut state = ExecutionState::new("ses_1", ProgressiveMode::Progressive, 0);

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_user_1".to_owned(),
                    role: ExecutionRole::User,
                    parent_id: None,
                },
                0,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                1,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    part_id: "part_1".to_owned(),
                    text: Some("hello".to_owned()),
                    delta: Some("lo".to_owned()),
                    ignored: false,
                },
                2,
            ),
            ProgressiveDirective::Preview("hello".to_owned())
        );
    }

    #[test]
    fn execution_state_switches_to_new_assistant_before_any_preview_text_arrives() {
        let mut state = ExecutionState::new("ses_1", ProgressiveMode::Progressive, 0);

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_user_1".to_owned(),
                    role: ExecutionRole::User,
                    parent_id: None,
                },
                0,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                1,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_2".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                2,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_2".to_owned(),
                    part_id: "part_2".to_owned(),
                    text: Some("second".to_owned()),
                    delta: None,
                    ignored: false,
                },
                3,
            ),
            ProgressiveDirective::Preview("second".to_owned())
        );
    }

    #[test]
    fn execution_state_keeps_existing_preview_stream_after_visible_text_arrives() {
        let mut state = ExecutionState::new("ses_1", ProgressiveMode::Progressive, 0);

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_user_1".to_owned(),
                    role: ExecutionRole::User,
                    parent_id: None,
                },
                0,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                1,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_1".to_owned(),
                    part_id: "part_1".to_owned(),
                    text: Some("first".to_owned()),
                    delta: None,
                    ignored: false,
                },
                2,
            ),
            ProgressiveDirective::Preview("first".to_owned())
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::MessageUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_2".to_owned(),
                    role: ExecutionRole::Assistant,
                    parent_id: Some("msg_user_1".to_owned()),
                },
                3,
            ),
            ProgressiveDirective::Noop
        );

        assert_eq!(
            state.observe(
                ExecutionObservation::TextPartUpdated {
                    session_id: "ses_1".to_owned(),
                    message_id: "msg_assistant_2".to_owned(),
                    part_id: "part_2".to_owned(),
                    text: Some("second".to_owned()),
                    delta: None,
                    ignored: false,
                },
                4,
            ),
            ProgressiveDirective::Noop
        );
    }
}
