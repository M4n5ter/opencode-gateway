//! Progressive text delivery state shared across host integrations.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgressiveMode {
    Oneshot,
    Progressive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgressivePreview {
    pub process_text: Option<String>,
    pub reasoning_text: Option<String>,
    pub answer_text: Option<String>,
}

impl ProgressivePreview {
    pub fn new(
        process_text: Option<String>,
        reasoning_text: Option<String>,
        answer_text: Option<String>,
    ) -> Self {
        Self {
            process_text: normalize_visible_text(process_text),
            reasoning_text: normalize_visible_text(reasoning_text),
            answer_text: normalize_visible_text(answer_text),
        }
    }

    pub fn answer(text: impl Into<String>) -> Self {
        Self::new(None, None, Some(text.into()))
    }

    pub fn is_empty(&self) -> bool {
        self.process_text.is_none()
            && self.reasoning_text.is_none()
            && self.answer_text.is_none()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProgressiveDirective {
    Noop,
    Preview(ProgressivePreview),
    Final(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgressiveTextState {
    mode: ProgressiveMode,
    flush_interval_ms: u64,
    pending_preview: Option<ProgressivePreview>,
    last_preview: Option<ProgressivePreview>,
    last_preview_at_ms: Option<u64>,
    finished: bool,
}

impl ProgressiveTextState {
    pub fn new(mode: ProgressiveMode, flush_interval_ms: u64) -> Self {
        Self {
            mode,
            flush_interval_ms,
            pending_preview: None,
            last_preview: None,
            last_preview_at_ms: None,
            finished: false,
        }
    }

    pub fn observe_snapshot(&mut self, preview: ProgressivePreview, now_ms: u64) -> ProgressiveDirective {
        if self.finished {
            return ProgressiveDirective::Noop;
        }

        self.pending_preview = Some(preview.clone());

        if self.mode == ProgressiveMode::Oneshot || preview.is_empty() {
            return ProgressiveDirective::Noop;
        }

        if self.last_preview.as_ref() == Some(&preview) {
            return ProgressiveDirective::Noop;
        }

        if self.should_flush(now_ms) {
            self.last_preview = Some(preview.clone());
            self.last_preview_at_ms = Some(now_ms);
            return ProgressiveDirective::Preview(preview);
        }

        ProgressiveDirective::Noop
    }

    pub fn finish(&mut self, final_text: impl Into<String>, now_ms: u64) -> ProgressiveDirective {
        self.finished = true;
        let final_text = final_text.into();
        let _ = now_ms;

        if final_text.trim().is_empty() {
            return ProgressiveDirective::Noop;
        }

        ProgressiveDirective::Final(final_text)
    }

    fn should_flush(&self, now_ms: u64) -> bool {
        self.last_preview_at_ms.is_none_or(|last_preview_at_ms| {
            now_ms.saturating_sub(last_preview_at_ms) >= self.flush_interval_ms
        })
    }
}

fn normalize_visible_text(text: Option<String>) -> Option<String> {
    text.filter(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::{ProgressiveDirective, ProgressiveMode, ProgressivePreview, ProgressiveTextState};

    #[test]
    fn oneshot_mode_never_emits_preview() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Oneshot, 400);

        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("hello"), 100),
            ProgressiveDirective::Noop
        );
        assert_eq!(
            state.finish("hello", 500),
            ProgressiveDirective::Final("hello".to_owned())
        );
    }

    #[test]
    fn progressive_mode_throttles_duplicate_preview_emission() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Progressive, 400);

        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("hello"), 100),
            ProgressiveDirective::Preview(ProgressivePreview::answer("hello"))
        );
        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("hello"), 150),
            ProgressiveDirective::Noop
        );
        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("hello world"), 200),
            ProgressiveDirective::Noop
        );
        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("hello world"), 550),
            ProgressiveDirective::Preview(ProgressivePreview::answer("hello world"))
        );
    }

    #[test]
    fn finish_returns_noop_for_empty_text() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Progressive, 400);

        assert_eq!(state.finish("", 100), ProgressiveDirective::Noop);
        assert_eq!(
            state.observe_snapshot(ProgressivePreview::answer("ignored after finish"), 600),
            ProgressiveDirective::Noop
        );
    }

    #[test]
    fn preview_normalizes_whitespace_only_segments() {
        assert_eq!(
            ProgressivePreview::new(
                Some(" \n ".to_owned()),
                Some(" \n ".to_owned()),
                Some("hello".to_owned()),
            ),
            ProgressivePreview {
                process_text: None,
                reasoning_text: None,
                answer_text: Some("hello".to_owned()),
            }
        );
    }
}
