//! Synchronous wasm handle for platform-agnostic progressive text state.

use opencode_gateway_core::{ProgressiveMode, ProgressiveTextState};
use wasm_bindgen::prelude::*;

use crate::binding::BindingProgressiveDirective;

#[wasm_bindgen]
pub struct ProgressiveTextHandle {
    state: ProgressiveTextState,
}

#[wasm_bindgen]
impl ProgressiveTextHandle {
    #[wasm_bindgen(js_name = progressive)]
    pub fn progressive(flush_interval_ms: u32) -> Self {
        Self::with_mode(ProgressiveMode::Progressive, flush_interval_ms)
    }

    #[wasm_bindgen(js_name = oneshot)]
    pub fn oneshot(flush_interval_ms: u32) -> Self {
        Self::with_mode(ProgressiveMode::Oneshot, flush_interval_ms)
    }

    #[wasm_bindgen(js_name = observeSnapshot)]
    pub fn observe_snapshot(&mut self, text: String, now_ms: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.observe_snapshot_value(text, now_ms))
    }

    pub fn finish(&mut self, final_text: String, now_ms: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.finish_value(final_text, now_ms))
    }
}

impl ProgressiveTextHandle {
    fn with_mode(mode: ProgressiveMode, flush_interval_ms: u32) -> Self {
        Self {
            state: ProgressiveTextState::new(mode, u64::from(flush_interval_ms)),
        }
    }

    fn observe_snapshot_value(&mut self, text: String, now_ms: u32) -> BindingProgressiveDirective {
        BindingProgressiveDirective::from(self.state.observe_snapshot(text, u64::from(now_ms)))
    }

    fn finish_value(&mut self, final_text: String, now_ms: u32) -> BindingProgressiveDirective {
        BindingProgressiveDirective::from(self.state.finish(final_text, u64::from(now_ms)))
    }
}

fn to_js_value(value: &BindingProgressiveDirective) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::ProgressiveTextHandle;
    use crate::binding::BindingProgressiveDirective;

    #[test]
    fn progressive_handle_emits_preview_and_final_directives() {
        let mut handle = ProgressiveTextHandle::progressive(400);

        let preview: BindingProgressiveDirective = handle.observe_snapshot_value("hello".to_owned(), 100);
        assert_eq!(preview.kind, "preview");
        assert_eq!(preview.text.as_deref(), Some("hello"));

        let final_directive: BindingProgressiveDirective =
            handle.finish_value("hello world".to_owned(), 700);
        assert_eq!(final_directive.kind, "final");
        assert_eq!(final_directive.text.as_deref(), Some("hello world"));
    }
}
