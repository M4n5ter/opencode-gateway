use crate::{OpencodeCommandPart, OpencodePrompt, OpencodePromptPart};

pub(super) fn prompt_message_id(prompt: &OpencodePrompt) -> String {
    let sanitized = prompt
        .prompt_key
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();

    format!("msg_gateway_{sanitized}")
}

pub(super) fn prompt_command_parts(
    prompt: &OpencodePrompt,
) -> Result<Vec<OpencodeCommandPart>, String> {
    prompt
        .parts
        .iter()
        .enumerate()
        .map(|(index, part)| match part {
            OpencodePromptPart::Text { text } => {
                OpencodeCommandPart::text(prompt_part_id(prompt, index), text.clone())
            }
            OpencodePromptPart::File {
                mime_type,
                file_name,
                local_path,
            } => OpencodeCommandPart::file(
                prompt_part_id(prompt, index),
                mime_type.clone(),
                file_name.clone(),
                local_path.clone(),
            ),
        })
        .collect()
}

fn prompt_part_id(prompt: &OpencodePrompt, index: usize) -> String {
    format!(
        "prt_gateway_{}_{}",
        sanitize_prompt_key(&prompt.prompt_key),
        index
    )
}

fn sanitize_prompt_key(value: &str) -> String {
    value
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
}
