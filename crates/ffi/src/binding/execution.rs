//! Synchronous wasm exports for prepared executions and execution handles.

use opencode_gateway_core::{
    CronJobSpec, ExecutionObservation, ExecutionState, InboundMessage, PreparedExecution,
    ProgressiveMode,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::binding::{
    BindingCronJobSpec, BindingExecutionObservation, BindingInboundMessage,
    BindingPreparedExecution, BindingProgressiveDirective,
};

const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

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

#[wasm_bindgen]
pub struct ExecutionHandle {
    state: ExecutionState,
}

#[wasm_bindgen]
impl ExecutionHandle {
    #[wasm_bindgen(js_name = progressive)]
    pub fn progressive(
        prepared: JsValue,
        session_id: String,
        flush_interval_ms: u32,
    ) -> Result<Self, JsValue> {
        let _prepared: BindingPreparedExecution = serde_wasm_bindgen::from_value(prepared)
            .map_err(|error| js_error(error.to_string()))?;
        let session_id = parse_required(session_id, "sessionId").map_err(js_error)?;

        Ok(Self {
            state: ExecutionState::new(
                session_id,
                ProgressiveMode::Progressive,
                u64::from(flush_interval_ms),
            ),
        })
    }

    #[wasm_bindgen(js_name = oneshot)]
    pub fn oneshot(
        prepared: JsValue,
        session_id: String,
        flush_interval_ms: u32,
    ) -> Result<Self, JsValue> {
        let _prepared: BindingPreparedExecution = serde_wasm_bindgen::from_value(prepared)
            .map_err(|error| js_error(error.to_string()))?;
        let session_id = parse_required(session_id, "sessionId").map_err(js_error)?;

        Ok(Self {
            state: ExecutionState::new(
                session_id,
                ProgressiveMode::Oneshot,
                u64::from(flush_interval_ms),
            ),
        })
    }

    #[wasm_bindgen(js_name = observeEvent)]
    pub fn observe_event(&mut self, observation: JsValue, now_ms: f64) -> Result<JsValue, JsValue> {
        let observation: BindingExecutionObservation = serde_wasm_bindgen::from_value(observation)
            .map_err(|error| js_error(error.to_string()))?;
        let now_ms = parse_js_timestamp(now_ms, "nowMs").map_err(js_error)?;
        let directive = self.state.observe(
            ExecutionObservation::try_from(observation).map_err(js_error)?,
            now_ms,
        );
        to_js_value(&BindingProgressiveDirective::from(directive))
    }

    pub fn finish(&mut self, final_text: String, now_ms: f64) -> Result<JsValue, JsValue> {
        let now_ms = parse_js_timestamp(now_ms, "nowMs").map_err(js_error)?;
        let directive = self.state.finish(final_text, now_ms);
        to_js_value(&BindingProgressiveDirective::from(directive))
    }
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

fn parse_js_timestamp(value: f64, field: &str) -> Result<u64, String> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 {
        return Err(format!("{field} must be a non-negative integer"));
    }

    if value > JS_MAX_SAFE_INTEGER as f64 {
        return Err(format!("{field} is out of range for JavaScript: {value}"));
    }

    Ok(value as u64)
}

fn parse_required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed.to_owned())
}

fn to_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| js_error(error.to_string()))
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

#[cfg(test)]
mod tests {
    use crate::binding::{BindingDeliveryTarget, BindingInboundMessage};

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
            body: "hello".to_owned(),
        })
        .expect("prepared");

        assert_eq!(
            prepared,
            BindingPreparedExecution {
                conversation_key: "telegram:42".to_owned(),
                prompt: "hello".to_owned(),
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
        assert_eq!(prepared.prompt, "summarize");
        assert!(prepared.reply_target.is_none());
    }
}
