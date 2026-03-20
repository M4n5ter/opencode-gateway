//! Domain contracts and pure planning logic for the opencode gateway.

pub mod channel;
pub mod conversation;
pub mod cron;
pub mod engine;
pub mod message;
pub mod progressive;
pub mod status;

pub use channel::{ChannelKind, TargetKey};
pub use conversation::ConversationKey;
pub use cron::{CronJobId, CronJobSpec, CronValidationError};
pub use engine::{GatewayEngine, GatewayPlan};
pub use message::{
    DeliveryTarget, InboundMessage, MessageValidationError, OutboundMessage, PromptRequest,
    PromptSource,
};
pub use progressive::{ProgressiveDirective, ProgressiveMode, ProgressiveTextState};
pub use status::GatewayStatus;
