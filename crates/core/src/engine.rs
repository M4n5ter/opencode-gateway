//! Pure gateway planning logic.

use crate::{
    CronJobSpec, CronValidationError, DeliveryTarget, GatewayStatus, InboundMessage,
    OutboundMessage, PromptRequest, PromptSource,
};

/// A pure plan that tells the host what prompt to run and whether a reply should be sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayPlan {
    pub request: PromptRequest,
    pub reply_target: Option<DeliveryTarget>,
}

impl GatewayPlan {
    /// Creates a new gateway plan.
    pub fn new(request: PromptRequest, reply_target: Option<DeliveryTarget>) -> Self {
        Self {
            request,
            reply_target,
        }
    }

    /// Builds an outbound host message from the reply target and `OpenCode` output.
    pub fn to_outbound_message(&self, response_text: impl Into<String>) -> Option<OutboundMessage> {
        self.reply_target
            .clone()
            .map(|target| OutboundMessage::new(target, response_text))
    }
}

/// Pure engine that turns validated domain inputs into host-executable plans.
#[derive(Debug, Default)]
pub struct GatewayEngine {
    status: GatewayStatus,
}

impl GatewayEngine {
    /// Creates a new pure gateway engine.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the current engine status snapshot.
    pub fn status(&self) -> &GatewayStatus {
        &self.status
    }

    /// Plans how an inbound IM message should be executed against `OpenCode`.
    pub fn plan_inbound_message(&self, message: &InboundMessage) -> GatewayPlan {
        let request = PromptRequest::new(
            message.conversation_key(),
            message.body.clone(),
            PromptSource::InboundMessage {
                channel: message.delivery_target.channel,
                sender: message.sender.clone(),
            },
        );

        GatewayPlan::new(request, Some(message.delivery_target.clone()))
    }

    /// Plans how a cron job should be executed against `OpenCode`.
    ///
    /// # Errors
    ///
    /// Returns a [`CronValidationError`] when the cron job fields are invalid.
    pub fn plan_cron_job(&self, job: &CronJobSpec) -> Result<GatewayPlan, CronValidationError> {
        job.validate()?;

        let request = PromptRequest::new(
            job.conversation_key.clone(),
            job.prompt.clone(),
            PromptSource::CronJob { id: job.id.clone() },
        );

        Ok(GatewayPlan::new(request, job.delivery_target.clone()))
    }
}

#[cfg(test)]
mod tests {
    use crate::{ChannelKind, CronJobSpec, GatewayEngine, InboundMessage, TargetKey};

    #[test]
    fn inbound_message_creates_reply_plan() {
        let engine = GatewayEngine::new();
        let target = TargetKey::new("123").expect("target key");
        let message =
            InboundMessage::new(ChannelKind::Telegram, target, None, "alice", "hello world")
                .expect("message");

        let plan = engine.plan_inbound_message(&message);

        assert_eq!(plan.request.prompt, "hello world");
        assert!(plan.reply_target.is_some());
    }

    #[test]
    fn cron_job_creates_reply_plan_when_delivery_is_present() {
        let engine = GatewayEngine::new();
        let job = CronJobSpec::with_delivery_target(
            "nightly",
            "0 0 * * *",
            "Summarize work",
            Some(crate::DeliveryTarget::new(
                ChannelKind::Telegram,
                TargetKey::new("123").expect("target key"),
                None,
            )),
        )
        .expect("cron job spec");

        let plan = engine.plan_cron_job(&job).expect("cron plan");

        assert_eq!(plan.request.conversation_key.as_str(), "cron:nightly");
        assert!(plan.reply_target.is_some());
    }
}
