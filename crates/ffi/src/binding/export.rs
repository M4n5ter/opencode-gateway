//! Synchronous wasm exports for gateway status and cron schedule calculation.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::binding::{BindingCronJobSpec, BindingDeliveryTarget, BindingGatewayStatus};

const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[wasm_bindgen(js_name = gatewayStatus)]
pub fn gateway_status() -> Result<JsValue, JsValue> {
    to_js_value(&gateway_status_value())
}

#[wasm_bindgen(js_name = nextCronRunAt)]
pub fn next_cron_run_at(job: JsValue, after_ms: f64, time_zone: String) -> Result<f64, JsValue> {
    let job: BindingCronJobSpec =
        serde_wasm_bindgen::from_value(job).map_err(|error| js_error(error.to_string()))?;
    let after_ms = parse_js_timestamp(after_ms, "afterMs").map_err(js_error)?;
    let next = next_cron_run_at_value(job, after_ms, &time_zone).map_err(js_error)?;
    Ok(next as f64)
}

#[wasm_bindgen(js_name = conversationKeyForDeliveryTarget)]
pub fn conversation_key_for_delivery_target(target: JsValue) -> Result<String, JsValue> {
    let target: BindingDeliveryTarget =
        serde_wasm_bindgen::from_value(target).map_err(|error| js_error(error.to_string()))?;
    conversation_key_for_delivery_target_value(target).map_err(js_error)
}

#[wasm_bindgen(js_name = normalizeCronTimeZone)]
pub fn normalize_cron_time_zone(time_zone: String) -> Result<String, JsValue> {
    normalize_cron_time_zone_value(&time_zone).map_err(js_error)
}

fn gateway_status_value() -> BindingGatewayStatus {
    BindingGatewayStatus::from(opencode_gateway_core::GatewayEngine::new().status())
}

fn next_cron_run_at_value(
    job: BindingCronJobSpec,
    after_ms: u64,
    time_zone: &str,
) -> Result<u64, String> {
    let next = opencode_gateway_core::CronJobSpec::try_from(job)?
        .next_run_at(after_ms, time_zone)
        .map_err(|error| error.to_string())?;

    if next > JS_MAX_SAFE_INTEGER {
        return Err(format!(
            "next cron run at is out of range for JavaScript: {next}"
        ));
    }

    Ok(next)
}

fn conversation_key_for_delivery_target_value(
    target: BindingDeliveryTarget,
) -> Result<String, String> {
    let target: opencode_gateway_core::DeliveryTarget = target.try_into()?;
    Ok(target.conversation_key().as_str().to_owned())
}

fn normalize_cron_time_zone_value(time_zone: &str) -> Result<String, String> {
    opencode_gateway_core::normalize_cron_time_zone(time_zone).map_err(|error| error.to_string())
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
    T: Serialize,
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
    use super::{
        conversation_key_for_delivery_target_value, next_cron_run_at_value,
        normalize_cron_time_zone_value,
    };
    use crate::binding::{BindingCronJobSpec, BindingDeliveryTarget};

    #[test]
    fn next_cron_run_at_computes_future_occurrence() {
        let next = next_cron_run_at_value(
            BindingCronJobSpec {
                id: "nightly".to_owned(),
                schedule: "0 9 * * *".to_owned(),
                prompt: "Summarize work".to_owned(),
                delivery_channel: None,
                delivery_target: None,
                delivery_topic: None,
            },
            1_735_689_600_000,
            "UTC",
        )
        .expect("next cron occurrence");

        assert_eq!(next, 1_735_722_000_000);
    }

    #[test]
    fn normalize_cron_time_zone_canonicalizes_iana_name() {
        let time_zone =
            normalize_cron_time_zone_value("Asia/Shanghai").expect("canonical time zone");

        assert_eq!(time_zone, "Asia/Shanghai");
    }

    #[test]
    fn normalize_cron_time_zone_rejects_invalid_value() {
        let error =
            normalize_cron_time_zone_value("Mars/Olympus").expect_err("expected invalid time zone");

        assert!(error.contains("invalid cron time zone"));
    }

    #[test]
    fn conversation_key_for_delivery_target_is_stable() {
        let key = conversation_key_for_delivery_target_value(BindingDeliveryTarget {
            channel: "telegram".to_owned(),
            target: "-100123456".to_owned(),
            topic: Some("42".to_owned()),
        })
        .expect("conversation key");

        assert_eq!(key, "telegram:-100123456:topic:42");
    }
}
