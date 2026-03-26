use opencode_gateway_core::{
    ExecutionObservation, ExecutionPartKind, ExecutionRole, ProgressiveDirective,
    ProgressiveMode, ProgressivePreview,
};

use crate::{
    OpencodeCommand, OpencodeCommandErrorCode, OpencodeCommandPart, OpencodeCommandResult,
    OpencodeExecutionDriver, OpencodeExecutionInput, OpencodeMessagePart, OpencodePrompt,
    OpencodePromptPart,
};

#[test]
fn stale_persisted_session_recreates_once_and_replays_batch() {
    let mut driver = create_driver(
        Some("ses_stale"),
        vec![
            create_text_prompt("mailbox:1", "first"),
            create_text_prompt("mailbox:2", "second"),
        ],
    );

    assert_eq!(
        driver.start(),
        command(OpencodeCommand::LookupSession {
            session_id: "ses_stale".to_owned(),
        })
    );

    assert_eq!(
        driver.resume(OpencodeCommandResult::LookupSession {
            session_id: "ses_stale".to_owned(),
            found: false,
        }),
        command(OpencodeCommand::CreateSession {
            title: "Gateway telegram:42".to_owned(),
        })
    );

    assert_eq!(
        driver.resume(OpencodeCommandResult::CreateSession {
            session_id: "ses_fresh".to_owned(),
        }),
        command(OpencodeCommand::WaitUntilIdle {
            session_id: "ses_fresh".to_owned(),
        })
    );

    assert_eq!(
        driver.resume(OpencodeCommandResult::WaitUntilIdle {
            session_id: "ses_fresh".to_owned(),
        }),
        command(OpencodeCommand::AppendPrompt {
            session_id: "ses_fresh".to_owned(),
            message_id: "msg_gateway_mailbox_1".to_owned(),
            parts: vec![
                OpencodeCommandPart::text("prt_gateway_mailbox_1_0", "first").expect("part")
            ],
        })
    );

    assert_eq!(
        driver.resume(OpencodeCommandResult::AppendPrompt {
            session_id: "ses_fresh".to_owned(),
        }),
        command(OpencodeCommand::SendPromptAsync {
            session_id: "ses_fresh".to_owned(),
            message_id: "msg_gateway_mailbox_2".to_owned(),
            parts: vec![
                OpencodeCommandPart::text("prt_gateway_mailbox_2_0", "second").expect("part")
            ],
        })
    );
}

#[test]
fn missing_session_error_retries_once_from_persisted_binding() {
    let mut driver = create_driver(
        Some("ses_stale"),
        vec![create_text_prompt("mailbox:1", "hello")],
    );

    let _ = driver.start();
    let _ = driver.resume(OpencodeCommandResult::LookupSession {
        session_id: "ses_stale".to_owned(),
        found: true,
    });

    assert_eq!(
        driver.resume(OpencodeCommandResult::Error(crate::OpencodeCommandError {
            command_kind: "waitUntilIdle".to_owned(),
            session_id: Some("ses_stale".to_owned()),
            code: OpencodeCommandErrorCode::MissingSession,
            message: "Session not found: ses_stale".to_owned(),
        })),
        command(OpencodeCommand::CreateSession {
            title: "Gateway telegram:42".to_owned(),
        })
    );
}

#[test]
fn observe_emits_preview_for_matching_assistant_events() {
    let mut driver = create_driver(None, vec![create_text_prompt("mailbox:1", "hello")]);

    let _ = driver.start();
    let _ = driver.resume(OpencodeCommandResult::CreateSession {
        session_id: "session-1".to_owned(),
    });

    assert_eq!(
        driver.observe(
            ExecutionObservation::MessageUpdated {
                session_id: "session-1".to_owned(),
                message_id: "msg_gateway_mailbox_1".to_owned(),
                role: ExecutionRole::User,
                parent_id: None,
            },
            1,
        ),
        ProgressiveDirective::Noop
    );
    assert_eq!(
        driver.observe(
            ExecutionObservation::MessageUpdated {
                session_id: "session-1".to_owned(),
                message_id: "msg_assistant_1".to_owned(),
                role: ExecutionRole::Assistant,
                parent_id: Some("msg_gateway_mailbox_1".to_owned()),
            },
            2,
        ),
        ProgressiveDirective::Noop
    );
    assert_eq!(
        driver.observe(
            ExecutionObservation::TextPartUpdated {
                session_id: "session-1".to_owned(),
                message_id: "msg_assistant_1".to_owned(),
                part_id: "part-1".to_owned(),
                part_kind: ExecutionPartKind::Text,
                text: None,
                delta: Some("hello".to_owned()),
                ignored: false,
            },
            3,
        ),
        ProgressiveDirective::Preview(ProgressivePreview::answer("hello"))
    );
}

#[test]
fn send_prompt_async_awaits_response_and_completes() {
    let mut driver = create_driver(None, vec![create_text_prompt("mailbox:1", "hello")]);

    assert_eq!(
        driver.start(),
        command(OpencodeCommand::CreateSession {
            title: "Gateway telegram:42".to_owned(),
        })
    );
    assert_eq!(
        driver.resume(OpencodeCommandResult::CreateSession {
            session_id: "session-1".to_owned(),
        }),
        command(OpencodeCommand::WaitUntilIdle {
            session_id: "session-1".to_owned(),
        })
    );
    assert_eq!(
        driver.resume(OpencodeCommandResult::WaitUntilIdle {
            session_id: "session-1".to_owned(),
        }),
        command(OpencodeCommand::SendPromptAsync {
            session_id: "session-1".to_owned(),
            message_id: "msg_gateway_mailbox_1".to_owned(),
            parts: vec![
                OpencodeCommandPart::text("prt_gateway_mailbox_1_0", "hello").expect("part")
            ],
        })
    );

    assert_eq!(
        driver.resume(OpencodeCommandResult::SendPromptAsync {
            session_id: "session-1".to_owned(),
        }),
        command(OpencodeCommand::AwaitPromptResponse {
            session_id: "session-1".to_owned(),
            message_id: "msg_gateway_mailbox_1".to_owned(),
        })
    );
    assert_eq!(
        driver.resume(OpencodeCommandResult::AwaitPromptResponse {
            session_id: "session-1".to_owned(),
            message_id: "msg_assistant_1".to_owned(),
            parts: vec![
                OpencodeMessagePart::new(
                    "msg_assistant_1",
                    "part-1",
                    "text",
                    Some("hello back".to_owned()),
                    false,
                )
                .expect("part"),
            ],
        }),
        crate::OpencodeDriverStep::Complete {
            session_id: "session-1".to_owned(),
            response_text: "hello back".to_owned(),
            final_text: Some("hello back".to_owned()),
        }
    );
}

#[test]
fn send_prompt_async_preserves_text_and_file_part_order() {
    let mut driver = create_driver(
        None,
        vec![
            OpencodePrompt::new(
                "mailbox:1",
                vec![
                    OpencodePromptPart::text("describe").expect("text part"),
                    OpencodePromptPart::file(
                        "image/png",
                        Some("photo.png".to_owned()),
                        "/tmp/photo.png",
                    )
                    .expect("file part"),
                ],
            )
            .expect("prompt"),
        ],
    );

    let _ = driver.start();
    let _ = driver.resume(OpencodeCommandResult::CreateSession {
        session_id: "session-1".to_owned(),
    });

    assert_eq!(
        driver.resume(OpencodeCommandResult::WaitUntilIdle {
            session_id: "session-1".to_owned(),
        }),
        command(OpencodeCommand::SendPromptAsync {
            session_id: "session-1".to_owned(),
            message_id: "msg_gateway_mailbox_1".to_owned(),
            parts: vec![
                OpencodeCommandPart::text("prt_gateway_mailbox_1_0", "describe").expect("part"),
                OpencodeCommandPart::file(
                    "prt_gateway_mailbox_1_1",
                    "image/png",
                    Some("photo.png".to_owned()),
                    "/tmp/photo.png",
                )
                .expect("part"),
            ],
        })
    );
}

#[test]
fn await_prompt_response_completes_without_assistant_event_binding() {
    let mut driver = create_driver(None, vec![create_text_prompt("mailbox:1", "hello")]);

    let _ = driver.start();
    let _ = driver.resume(OpencodeCommandResult::CreateSession {
        session_id: "session-1".to_owned(),
    });
    let _ = driver.resume(OpencodeCommandResult::WaitUntilIdle {
        session_id: "session-1".to_owned(),
    });

    assert_eq!(
        driver.resume(OpencodeCommandResult::SendPromptAsync {
            session_id: "session-1".to_owned(),
        }),
        command(OpencodeCommand::AwaitPromptResponse {
            session_id: "session-1".to_owned(),
            message_id: "msg_gateway_mailbox_1".to_owned(),
        })
    );
    assert_eq!(
        driver.resume(OpencodeCommandResult::AwaitPromptResponse {
            session_id: "session-1".to_owned(),
            message_id: "msg_assistant_1".to_owned(),
            parts: vec![
                OpencodeMessagePart::new(
                    "msg_assistant_1",
                    "part-1",
                    "text",
                    Some("hello back".to_owned()),
                    false,
                )
                .expect("part"),
            ],
        }),
        crate::OpencodeDriverStep::Complete {
            session_id: "session-1".to_owned(),
            response_text: "hello back".to_owned(),
            final_text: Some("hello back".to_owned()),
        }
    );
}

fn create_driver(
    persisted_session_id: Option<&str>,
    prompts: Vec<OpencodePrompt>,
) -> OpencodeExecutionDriver {
    OpencodeExecutionDriver::new(
        OpencodeExecutionInput::new(
            "telegram:42",
            persisted_session_id.map(str::to_owned),
            ProgressiveMode::Progressive,
            400,
            prompts,
        )
        .expect("input"),
    )
}

fn command(command: OpencodeCommand) -> crate::OpencodeDriverStep {
    crate::OpencodeDriverStep::Command(command)
}

fn create_text_prompt(prompt_key: &str, text: &str) -> OpencodePrompt {
    OpencodePrompt::new(
        prompt_key,
        vec![OpencodePromptPart::text(text).expect("text part")],
    )
    .expect("prompt")
}
