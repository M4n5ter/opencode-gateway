//! Gateway status snapshot types.

/// Minimal summary of the current gateway state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayStatus {
    pub runtime_mode: &'static str,
    pub supports_telegram: bool,
    pub supports_cron: bool,
    pub has_web_ui: bool,
}

impl Default for GatewayStatus {
    fn default() -> Self {
        Self {
            runtime_mode: "contract",
            supports_telegram: true,
            supports_cron: true,
            has_web_ui: false,
        }
    }
}
