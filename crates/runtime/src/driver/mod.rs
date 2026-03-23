//! OpenCode execution driver that emits host commands one step at a time.

mod prompt_ids;
mod render;

use opencode_gateway_core::{ExecutionObservation, ExecutionState, ProgressiveDirective};

use crate::types::{
    OpencodeCommand, OpencodeCommandErrorCode, OpencodeCommandResult, OpencodeDriverStep,
    OpencodeExecutionInput,
};

use self::{prompt_ids::prompt_ids, render::render_visible_text};

#[derive(Debug)]
pub struct OpencodeExecutionDriver {
    input: OpencodeExecutionInput,
    phase: DriverPhase,
    current_session_id: Option<String>,
    execution: Option<ExecutionState>,
    missing_session_retry_used: bool,
}

impl OpencodeExecutionDriver {
    pub fn new(input: OpencodeExecutionInput) -> Self {
        Self {
            input,
            phase: DriverPhase::Initial,
            current_session_id: None,
            execution: None,
            missing_session_retry_used: false,
        }
    }

    pub fn start(&mut self) -> OpencodeDriverStep {
        if !matches!(self.phase, DriverPhase::Initial) {
            return self.fail("driver has already started");
        }

        if let Some(session_id) = self.input.persisted_session_id.clone() {
            self.phase = DriverPhase::AwaitingLookup;
            return OpencodeDriverStep::Command(OpencodeCommand::LookupSession { session_id });
        }

        self.issue_create_session()
    }

    pub fn resume(&mut self, result: OpencodeCommandResult) -> OpencodeDriverStep {
        if matches!(self.phase, DriverPhase::Finished | DriverPhase::Failed) {
            return self.fail("driver has already completed");
        }

        if let OpencodeCommandResult::Error(error) = result {
            if error.code == OpencodeCommandErrorCode::MissingSession
                && self.input.persisted_session_id.is_some()
                && !self.missing_session_retry_used
            {
                self.missing_session_retry_used = true;
                self.current_session_id = None;
                self.execution = None;
                return self.issue_create_session();
            }

            return self.fail(error.message);
        }

        match (&self.phase, result) {
            (
                DriverPhase::AwaitingLookup,
                OpencodeCommandResult::LookupSession { session_id, found },
            ) => {
                if found {
                    self.current_session_id = Some(session_id.clone());
                    self.reset_execution(session_id);
                    self.issue_wait_until_idle(IdleStage::BeforePromptDispatch)
                } else {
                    self.current_session_id = None;
                    self.execution = None;
                    self.issue_create_session()
                }
            }
            (DriverPhase::AwaitingCreate, OpencodeCommandResult::CreateSession { session_id }) => {
                self.current_session_id = Some(session_id.clone());
                self.reset_execution(session_id);
                self.issue_wait_until_idle(IdleStage::BeforePromptDispatch)
            }
            (
                DriverPhase::AwaitingIdle(IdleStage::BeforePromptDispatch),
                OpencodeCommandResult::WaitUntilIdle { session_id },
            ) => {
                if !self.is_current_session(&session_id) {
                    return self.fail(format!(
                        "waitUntilIdle resolved for unexpected session: {session_id}"
                    ));
                }

                if self.input.prompts.len() > 1 {
                    self.issue_append_prompt(0)
                } else {
                    self.issue_send_prompt_async(self.input.prompts.len() - 1)
                }
            }
            (
                DriverPhase::AwaitingAppend { index },
                OpencodeCommandResult::AppendPrompt { session_id },
            ) => {
                if !self.is_current_session(&session_id) {
                    return self.fail(format!(
                        "appendPrompt resolved for unexpected session: {session_id}"
                    ));
                }

                let next_index = index.saturating_add(1);
                if next_index < self.input.prompts.len() - 1 {
                    self.issue_append_prompt(next_index)
                } else {
                    self.issue_send_prompt_async(self.input.prompts.len() - 1)
                }
            }
            (DriverPhase::AwaitingSend, OpencodeCommandResult::SendPromptAsync { session_id }) => {
                if !self.is_current_session(&session_id) {
                    return self.fail(format!(
                        "sendPromptAsync resolved for unexpected session: {session_id}"
                    ));
                }

                self.issue_await_prompt_response()
            }
            (
                DriverPhase::AwaitingPromptResponse,
                OpencodeCommandResult::AwaitPromptResponse {
                    session_id,
                    message_id,
                    parts,
                },
            ) => {
                if !self.is_current_session(&session_id) {
                    return self.fail(format!(
                        "awaitPromptResponse resolved for unexpected session: {session_id}"
                    ));
                }

                let response_text = render_visible_text(&message_id, &parts);
                let final_text = self.finish_execution(&response_text);
                self.phase = DriverPhase::Finished;

                OpencodeDriverStep::Complete {
                    session_id,
                    response_text,
                    final_text,
                }
            }
            (phase, result) => self.fail(format!(
                "driver received unexpected result while in {phase:?}: {result:?}"
            )),
        }
    }

    pub fn observe(
        &mut self,
        observation: ExecutionObservation,
        now_ms: u64,
    ) -> ProgressiveDirective {
        self.execution
            .as_mut()
            .map_or(ProgressiveDirective::Noop, |execution| {
                execution.observe(observation, now_ms)
            })
    }

    fn issue_create_session(&mut self) -> OpencodeDriverStep {
        self.phase = DriverPhase::AwaitingCreate;
        OpencodeDriverStep::Command(OpencodeCommand::CreateSession {
            title: format!("Gateway {}", self.input.conversation_key),
        })
    }

    fn issue_wait_until_idle(&mut self, stage: IdleStage) -> OpencodeDriverStep {
        let Some(session_id) = self.current_session_id.clone() else {
            return self.fail("session is unavailable before waitUntilIdle");
        };

        self.phase = DriverPhase::AwaitingIdle(stage);
        OpencodeDriverStep::Command(OpencodeCommand::WaitUntilIdle { session_id })
    }

    fn issue_append_prompt(&mut self, index: usize) -> OpencodeDriverStep {
        let Some(session_id) = self.current_session_id.clone() else {
            return self.fail("session is unavailable before appendPrompt");
        };
        let Some(prompt) = self.input.prompts.get(index) else {
            return self.fail(format!("appendPrompt index is out of range: {index}"));
        };
        let (message_id, text_part_id) = prompt_ids(prompt);

        self.phase = DriverPhase::AwaitingAppend { index };
        OpencodeDriverStep::Command(OpencodeCommand::AppendPrompt {
            session_id,
            message_id,
            text_part_id,
            prompt: prompt.prompt.clone(),
        })
    }

    fn issue_send_prompt_async(&mut self, index: usize) -> OpencodeDriverStep {
        let Some(session_id) = self.current_session_id.clone() else {
            return self.fail("session is unavailable before sendPromptAsync");
        };
        let Some(prompt) = self.input.prompts.get(index) else {
            return self.fail(format!("sendPromptAsync index is out of range: {index}"));
        };
        let (message_id, text_part_id) = prompt_ids(prompt);

        self.phase = DriverPhase::AwaitingSend;
        OpencodeDriverStep::Command(OpencodeCommand::SendPromptAsync {
            session_id,
            message_id,
            text_part_id,
            prompt: prompt.prompt.clone(),
        })
    }

    fn issue_await_prompt_response(&mut self) -> OpencodeDriverStep {
        let Some(session_id) = self.current_session_id.clone() else {
            return self.fail("session is unavailable before awaitPromptResponse");
        };
        let Some(message_id) = self.final_prompt_message_id() else {
            return self.fail("final prompt message id is unavailable before awaitPromptResponse");
        };

        self.phase = DriverPhase::AwaitingPromptResponse;
        OpencodeDriverStep::Command(OpencodeCommand::AwaitPromptResponse {
            session_id,
            message_id,
        })
    }

    fn reset_execution(&mut self, session_id: String) {
        self.execution = Some(ExecutionState::new(
            session_id,
            self.input.mode,
            self.input.flush_interval_ms,
        ));
    }

    fn finish_execution(&mut self, response_text: &str) -> Option<String> {
        let Some(execution) = self.execution.as_mut() else {
            return if response_text.is_empty() {
                None
            } else {
                Some(response_text.to_owned())
            };
        };

        match execution.finish(response_text.to_owned(), 0) {
            ProgressiveDirective::Final(text) => Some(text),
            ProgressiveDirective::Noop | ProgressiveDirective::Preview(_) => None,
        }
    }

    fn is_current_session(&self, session_id: &str) -> bool {
        self.current_session_id.as_deref() == Some(session_id)
    }

    fn final_prompt_message_id(&self) -> Option<String> {
        self.input.prompts.last().map(|prompt| prompt_ids(prompt).0)
    }

    fn fail(&mut self, message: impl Into<String>) -> OpencodeDriverStep {
        self.phase = DriverPhase::Failed;
        OpencodeDriverStep::Failed {
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DriverPhase {
    Initial,
    AwaitingLookup,
    AwaitingCreate,
    AwaitingIdle(IdleStage),
    AwaitingAppend { index: usize },
    AwaitingSend,
    AwaitingPromptResponse,
    Finished,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdleStage {
    BeforePromptDispatch,
}

#[cfg(test)]
mod tests;
