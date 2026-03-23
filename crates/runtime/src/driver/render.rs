use crate::OpencodeMessagePart;

pub(super) fn render_visible_text(message_id: &str, parts: &[OpencodeMessagePart]) -> String {
    parts
        .iter()
        .filter(|part| {
            part.message_id == message_id
                && part.kind == "text"
                && !part.ignored
                && part.text.as_deref().is_some_and(|text| !text.is_empty())
        })
        .filter_map(|part| part.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use crate::OpencodeMessagePart;

    use super::render_visible_text;

    #[test]
    fn render_visible_text_ignores_non_text_and_ignored_parts() {
        let parts = vec![
            OpencodeMessagePart::new("msg_1", "part_1", "text", Some("hello".to_owned()), false)
                .expect("part"),
            OpencodeMessagePart::new(
                "msg_1",
                "part_2",
                "step-start",
                Some("ignored".to_owned()),
                false,
            )
            .expect("part"),
            OpencodeMessagePart::new("msg_1", "part_3", "text", Some("hidden".to_owned()), true)
                .expect("part"),
            OpencodeMessagePart::new("msg_2", "part_4", "text", Some("other".to_owned()), false)
                .expect("part"),
            OpencodeMessagePart::new("msg_1", "part_5", "text", Some("world".to_owned()), false)
                .expect("part"),
        ];

        assert_eq!(render_visible_text("msg_1", &parts), "hello\nworld");
    }
}
