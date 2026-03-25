export function buildGatewayConfigTemplate(stateDbPath: string): string {
    return [
        "# Opencode Gateway configuration",
        "# Fill in secrets and provider details before enabling real integrations.",
        "",
        "[gateway]",
        `state_db = "${escapeTomlString(stateDbPath)}"`,
        '# log_level = "warn"',
        "",
        "[cron]",
        "enabled = true",
        "tick_seconds = 5",
        "max_concurrent_runs = 1",
        '# timezone = "Asia/Shanghai"',
        "",
        "[channels.telegram]",
        "enabled = false",
        'bot_token_env = "TELEGRAM_BOT_TOKEN"',
        "poll_timeout_seconds = 25",
        "allowed_chats = []",
        "allowed_users = []",
        "",
        "# Optional long-lived memory sources injected into gateway-managed sessions.",
        "# Relative paths are resolved from opencode-gateway-workspace.",
        "#",
        "# [[memory.entries]]",
        '# path = "memory/project.md"',
        '# description = "Project conventions and long-lived context"',
        "# inject_content = true",
        "#",
        "# [[memory.entries]]",
        '# path = "memory/notes"',
        '# description = "Domain notes and operating docs"',
        "# inject_markdown_contents = true",
        '# globs = ["**/*.rs", "notes/**/*.txt"]',
        "",
    ].join("\n")
}

function escapeTomlString(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
