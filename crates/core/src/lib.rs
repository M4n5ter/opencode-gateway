//! Domain contracts and pure planning logic for the opencode gateway.

pub mod channel;
pub mod conversation;
pub mod cron;
pub mod engine;
pub mod execution;
pub mod message;
pub mod progressive;
pub mod status;

pub use channel::{ChannelKind, TargetKey};
pub use conversation::ConversationKey;
pub use cron::{CronJobId, CronJobSpec, CronValidationError, normalize_cron_time_zone};
pub use engine::{GatewayEngine, GatewayPlan};
pub use execution::{ExecutionObservation, ExecutionRole, ExecutionState, PreparedExecution};
pub use message::{
    DeliveryTarget, InboundAttachment, InboundAttachmentKind, InboundMessage,
    MessageValidationError, OutboundMessage, PromptPart, PromptRequest, PromptSource,
};
pub use progressive::{ProgressiveDirective, ProgressiveMode, ProgressivePreview, ProgressiveTextState};
pub use status::GatewayStatus;
