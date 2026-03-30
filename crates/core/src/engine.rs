//! Pure gateway planning logic.

use crate::{
    CronJobSpec, CronValidationError, DeliveryTarget, GatewayStatus, InboundMessage,
    OutboundMessage, PromptPart, PromptRequest, PromptSource, ReplyAttachmentKind,
    ReplyAttachmentSummary, ReplyContext,
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
        let mut parts = Vec::new();
        if let Some(reply_context) = &message.reply_context {
            parts.push(PromptPart::Text(render_reply_context_prompt(reply_context)));
        }
        if let Some(text) = &message.text {
            parts.push(PromptPart::Text(text.clone()));
        }
        parts.extend(
            message
                .attachments
                .iter()
                .map(|attachment| attachment.to_prompt_part()),
        );

        let request = PromptRequest::with_parts(
            message.conversation_key(),
            parts,
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

        let request = PromptRequest::from_text(
            job.conversation_key.clone(),
            job.prompt.clone(),
            PromptSource::CronJob { id: job.id.clone() },
        )
        .map_err(|_error| CronValidationError::EmptyPrompt)?;

        Ok(GatewayPlan::new(request, job.delivery_target.clone()))
    }
}

fn render_reply_context_prompt(reply_context: &ReplyContext) -> String {
    let mut lines = vec![
        "[Gateway reply context]".to_owned(),
        format!("reply_message_id={}", reply_context.message_id),
        format!(
            "reply_sender={}",
            reply_context.sender.as_deref().unwrap_or("unknown")
        ),
        format!(
            "reply_sender_is_bot={}",
            render_optional_bool(reply_context.sender_is_bot)
        ),
        format!(
            "reply_text_truncated={}",
            render_bool(reply_context.text_truncated)
        ),
        format!("reply_attachment_count={}", reply_context.attachments.len()),
    ];

    for (index, attachment) in reply_context.attachments.iter().enumerate() {
        lines.push(format!(
            "reply_attachment_{}={}",
            index + 1,
            render_reply_attachment_summary(attachment)
        ));
    }

    lines.push(String::new());
    lines.push("[Quoted message]".to_owned());
    lines.push(
        reply_context
            .text
            .clone()
            .unwrap_or_else(|| "[no text content]".to_owned()),
    );
    if reply_context.text_truncated {
        lines.push("[truncated]".to_owned());
    }

    lines.join("\n")
}

fn render_reply_attachment_summary(attachment: &ReplyAttachmentSummary) -> String {
    let mut parts = vec![match attachment.kind {
        ReplyAttachmentKind::Image => "image".to_owned(),
    }];

    if let Some(mime_type) = &attachment.mime_type {
        parts.push(format!("mime_type={mime_type}"));
    }
    if let Some(file_name) = &attachment.file_name {
        parts.push(format!("file_name={file_name}"));
    }

    parts.join(" ")
}

fn render_bool(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

fn render_optional_bool(value: Option<bool>) -> &'static str {
    match value {
        Some(true) => "true",
        Some(false) => "false",
        None => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ChannelKind, CronJobSpec, GatewayEngine, InboundMessage, PromptPart,
        ReplyAttachmentSummary, ReplyContext, TargetKey,
    };

    #[test]
    fn inbound_message_creates_reply_plan() {
        let engine = GatewayEngine::new();
        let target = TargetKey::new("123").expect("target key");
        let message = InboundMessage::new(
            ChannelKind::Telegram,
            target,
            None,
            "alice",
            Some("hello world".to_owned()),
            vec![],
        )
        .expect("message");

        let plan = engine.plan_inbound_message(&message);

        assert_eq!(
            plan.request.parts,
            vec![PromptPart::Text("hello world".to_owned())]
        );
        assert!(plan.reply_target.is_some());
    }

    #[test]
    fn inbound_reply_context_is_prepended_before_the_current_message() {
        let engine = GatewayEngine::new();
        let target = TargetKey::new("123").expect("target key");
        let mut message = InboundMessage::new(
            ChannelKind::Telegram,
            target,
            None,
            "alice",
            Some("follow up".to_owned()),
            vec![],
        )
        .expect("message");
        message.set_reply_context(
            ReplyContext::new(
                "77",
                Some("telegram:42".to_owned()),
                Some(true),
                Some("prior assistant answer".to_owned()),
                false,
                vec![ReplyAttachmentSummary::image(
                    Some("image/png".to_owned()),
                    Some("chart.png".to_owned()),
                )],
            )
            .expect("reply context"),
        );

        let plan = engine.plan_inbound_message(&message);

        assert_eq!(
            plan.request.parts,
            vec![
                PromptPart::Text(super::render_reply_context_prompt(
                    message.reply_context.as_ref().expect("reply context"),
                )),
                PromptPart::Text("follow up".to_owned()),
            ]
        );
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
