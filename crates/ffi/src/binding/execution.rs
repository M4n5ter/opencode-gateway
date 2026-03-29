//! Synchronous wasm exports for prepared executions.

use opencode_gateway_core::{CronJobSpec, InboundMessage, PreparedExecution};
use wasm_bindgen::prelude::*;

use crate::binding::{BindingCronJobSpec, BindingInboundMessage, BindingPreparedExecution};

#[wasm_bindgen(js_name = prepareInboundExecution)]
pub fn prepare_inbound_execution(message: JsValue) -> Result<JsValue, JsValue> {
    let message: BindingInboundMessage =
        serde_wasm_bindgen::from_value(message).map_err(|error| js_error(error.to_string()))?;
    let prepared = prepare_inbound_execution_value(message).map_err(js_error)?;
    to_js_value(&prepared)
}

#[wasm_bindgen(js_name = prepareCronExecution)]
pub fn prepare_cron_execution(job: JsValue) -> Result<JsValue, JsValue> {
    let job: BindingCronJobSpec =
        serde_wasm_bindgen::from_value(job).map_err(|error| js_error(error.to_string()))?;
    let prepared = prepare_cron_execution_value(job).map_err(js_error)?;
    to_js_value(&prepared)
}

fn prepare_inbound_execution_value(
    message: BindingInboundMessage,
) -> Result<BindingPreparedExecution, String> {
    let message: InboundMessage = message.try_into()?;

    Ok(BindingPreparedExecution::from(
        PreparedExecution::for_inbound_message(&message),
    ))
}

fn prepare_cron_execution_value(
    job: BindingCronJobSpec,
) -> Result<BindingPreparedExecution, String> {
    let job = CronJobSpec::try_from(job)?;
    PreparedExecution::for_cron_job(&job)
        .map(BindingPreparedExecution::from)
        .map_err(|error| error.to_string())
}

fn to_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: serde::Serialize,
{
    value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
        .map_err(|error| js_error(error.to_string()))
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

#[cfg(test)]
mod tests {
    use crate::binding::{
        BindingDeliveryTarget, BindingInboundMessage, BindingPromptPart, BindingReplyContext,
        BindingReplyContextAttachment,
    };

    use super::{BindingCronJobSpec, BindingPreparedExecution};
    use super::{prepare_cron_execution_value, prepare_inbound_execution_value};

    #[test]
    fn prepare_inbound_execution_builds_conversation_key() {
        let prepared = prepare_inbound_execution_value(BindingInboundMessage {
            delivery_target: BindingDeliveryTarget {
                channel: "telegram".to_owned(),
                target: "42".to_owned(),
                topic: None,
            },
            sender: "telegram:7".to_owned(),
            text: Some("hello".to_owned()),
            attachments: vec![],
            mailbox_key: None,
            reply_context: None,
        })
        .expect("prepared");

        assert_eq!(
            prepared,
            BindingPreparedExecution {
                conversation_key: "telegram:42".to_owned(),
                prompt_parts: vec![BindingPromptPart::Text {
                    text: "hello".to_owned(),
                }],
                reply_target: Some(BindingDeliveryTarget {
                    channel: "telegram".to_owned(),
                    target: "42".to_owned(),
                    topic: None,
                }),
            }
        );
    }

    #[test]
    fn prepare_cron_execution_builds_cron_conversation_key() {
        let prepared = prepare_cron_execution_value(BindingCronJobSpec {
            id: "nightly".to_owned(),
            schedule: "0 9 * * *".to_owned(),
            prompt: "summarize".to_owned(),
            delivery_channel: None,
            delivery_target: None,
            delivery_topic: None,
        })
        .expect("prepared");

        assert_eq!(prepared.conversation_key, "cron:nightly");
        assert_eq!(
            prepared.prompt_parts,
            vec![BindingPromptPart::Text {
                text: "summarize".to_owned(),
            }]
        );
        assert!(prepared.reply_target.is_none());
    }

    #[test]
    fn prepare_inbound_execution_honors_mailbox_override() {
        let prepared = prepare_inbound_execution_value(BindingInboundMessage {
            delivery_target: BindingDeliveryTarget {
                channel: "telegram".to_owned(),
                target: "42".to_owned(),
                topic: None,
            },
            sender: "telegram:7".to_owned(),
            text: Some("hello".to_owned()),
            attachments: vec![],
            mailbox_key: Some("shared:mailbox".to_owned()),
            reply_context: None,
        })
        .expect("prepared");

        assert_eq!(prepared.conversation_key, "shared:mailbox");
    }

    #[test]
    fn prepare_inbound_execution_prepends_reply_context() {
        let prepared = prepare_inbound_execution_value(BindingInboundMessage {
            delivery_target: BindingDeliveryTarget {
                channel: "telegram".to_owned(),
                target: "42".to_owned(),
                topic: None,
            },
            sender: "telegram:7".to_owned(),
            text: Some("follow up".to_owned()),
            attachments: vec![],
            mailbox_key: None,
            reply_context: Some(BindingReplyContext {
                message_id: "77".to_owned(),
                sender: Some("telegram:42".to_owned()),
                sender_is_bot: Some(true),
                text: Some("prior answer".to_owned()),
                text_truncated: false,
                attachments: vec![BindingReplyContextAttachment::Image {
                    mime_type: Some("image/png".to_owned()),
                    file_name: Some("chart.png".to_owned()),
                }],
            }),
        })
        .expect("prepared");

        assert_eq!(prepared.prompt_parts.len(), 2);
        match &prepared.prompt_parts[0] {
            BindingPromptPart::Text { text } => {
                assert!(text.contains("[Gateway reply context]"));
                assert!(text.contains("reply_message_id=77"));
                assert!(text.contains("reply_sender=telegram:42"));
                assert!(text.contains("reply_sender_is_bot=true"));
                assert!(text.contains("reply_attachment_1=image mime_type=image/png file_name=chart.png"));
                assert!(text.contains("[Quoted message]\nprior answer"));
            }
            other => panic!("expected text prompt part, got {other:?}"),
        }
        assert_eq!(
            prepared.prompt_parts[1],
            BindingPromptPart::Text {
                text: "follow up".to_owned(),
            }
        );
    }
}
