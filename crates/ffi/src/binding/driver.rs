//! Sync wasm exports for the OpenCode execution driver.

use opencode_gateway_core::ExecutionObservation;
use opencode_gateway_runtime::OpencodeExecutionDriver as RuntimeDriver;
use wasm_bindgen::prelude::*;

use crate::binding::{
    BindingExecutionObservation, BindingOpencodeCommandResult, BindingOpencodeDriverStep,
    BindingOpencodeExecutionInput, BindingProgressiveDirective,
};

const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[wasm_bindgen]
pub struct OpencodeExecutionDriver {
    inner: RuntimeDriver,
}

#[wasm_bindgen]
impl OpencodeExecutionDriver {
    #[wasm_bindgen(constructor)]
    pub fn new(input: JsValue) -> Result<Self, JsValue> {
        let input: BindingOpencodeExecutionInput =
            serde_wasm_bindgen::from_value(input).map_err(|error| js_error(error.to_string()))?;

        Ok(Self {
            inner: RuntimeDriver::new(input.try_into().map_err(js_error)?),
        })
    }

    pub fn start(&mut self) -> Result<JsValue, JsValue> {
        to_js_value(&BindingOpencodeDriverStep::from(self.inner.start()))
    }

    pub fn resume(&mut self, result: JsValue) -> Result<JsValue, JsValue> {
        let result: BindingOpencodeCommandResult =
            serde_wasm_bindgen::from_value(result).map_err(|error| js_error(error.to_string()))?;
        let step = self.inner.resume(result.try_into().map_err(js_error)?);
        to_js_value(&BindingOpencodeDriverStep::from(step))
    }

    #[wasm_bindgen(js_name = observeEvent)]
    pub fn observe_event(&mut self, observation: JsValue, now_ms: f64) -> Result<JsValue, JsValue> {
        let observation: BindingExecutionObservation = serde_wasm_bindgen::from_value(observation)
            .map_err(|error| js_error(error.to_string()))?;
        let now_ms = parse_js_timestamp(now_ms, "nowMs").map_err(js_error)?;
        let directive = self.inner.observe(
            ExecutionObservation::try_from(observation).map_err(js_error)?,
            now_ms,
        );
        to_js_value(&BindingProgressiveDirective::from(directive))
    }
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
