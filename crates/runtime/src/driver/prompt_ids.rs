use crate::OpencodePrompt;

pub(super) fn prompt_ids(prompt: &OpencodePrompt) -> (String, String) {
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

    (
        format!("msg_gateway_{sanitized}"),
        format!("prt_gateway_{sanitized}"),
    )
}
