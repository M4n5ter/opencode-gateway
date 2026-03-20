//! Progressive text delivery state shared across host integrations.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgressiveMode {
    Oneshot,
    Progressive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProgressiveDirective {
    Noop,
    Preview(String),
    Final(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgressiveTextState {
    mode: ProgressiveMode,
    flush_interval_ms: u64,
    pending_text: Option<String>,
    last_preview_text: Option<String>,
    last_preview_at_ms: Option<u64>,
    finished: bool,
}

impl ProgressiveTextState {
    pub fn new(mode: ProgressiveMode, flush_interval_ms: u64) -> Self {
        Self {
            mode,
            flush_interval_ms,
            pending_text: None,
            last_preview_text: None,
            last_preview_at_ms: None,
            finished: false,
        }
    }

    pub fn observe_snapshot(&mut self, text: impl Into<String>, now_ms: u64) -> ProgressiveDirective {
        if self.finished {
            return ProgressiveDirective::Noop;
        }

        let text = text.into();
        self.pending_text = Some(text.clone());

        if self.mode == ProgressiveMode::Oneshot || text.is_empty() {
            return ProgressiveDirective::Noop;
        }

        if self.last_preview_text.as_deref() == Some(text.as_str()) {
            return ProgressiveDirective::Noop;
        }

        if self.should_flush(now_ms) {
            self.last_preview_text = Some(text.clone());
            self.last_preview_at_ms = Some(now_ms);
            return ProgressiveDirective::Preview(text);
        }

        ProgressiveDirective::Noop
    }

    pub fn finish(&mut self, final_text: impl Into<String>, now_ms: u64) -> ProgressiveDirective {
        self.finished = true;
        let final_text = final_text.into();
        self.pending_text = Some(final_text.clone());

        if !final_text.is_empty() && self.mode == ProgressiveMode::Progressive {
            self.last_preview_text = Some(final_text.clone());
            self.last_preview_at_ms = Some(now_ms);
        }

        if final_text.is_empty() {
            return ProgressiveDirective::Noop;
        }

        ProgressiveDirective::Final(final_text)
    }

    fn should_flush(&self, now_ms: u64) -> bool {
        self.last_preview_at_ms
            .is_none_or(|last_preview_at_ms| now_ms.saturating_sub(last_preview_at_ms) >= self.flush_interval_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::{ProgressiveDirective, ProgressiveMode, ProgressiveTextState};

    #[test]
    fn oneshot_mode_never_emits_preview() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Oneshot, 400);

        assert_eq!(state.observe_snapshot("hello", 100), ProgressiveDirective::Noop);
        assert_eq!(state.finish("hello", 500), ProgressiveDirective::Final("hello".to_owned()));
    }

    #[test]
    fn progressive_mode_throttles_duplicate_preview_emission() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Progressive, 400);

        assert_eq!(
            state.observe_snapshot("hello", 100),
            ProgressiveDirective::Preview("hello".to_owned())
        );
        assert_eq!(state.observe_snapshot("hello", 150), ProgressiveDirective::Noop);
        assert_eq!(state.observe_snapshot("hello world", 200), ProgressiveDirective::Noop);
        assert_eq!(
            state.observe_snapshot("hello world", 550),
            ProgressiveDirective::Preview("hello world".to_owned())
        );
    }

    #[test]
    fn finish_returns_noop_for_empty_text() {
        let mut state = ProgressiveTextState::new(ProgressiveMode::Progressive, 400);

        assert_eq!(state.finish("", 100), ProgressiveDirective::Noop);
        assert_eq!(state.observe_snapshot("ignored after finish", 600), ProgressiveDirective::Noop);
    }
}
