export function buildGatewayConfigTemplate(stateDbPath: string): string {
    return [
        "# Opencode Gateway configuration",
        "# Fill in secrets and provider details before enabling real integrations.",
        "",
        "[gateway]",
        `state_db = "${escapeTomlString(stateDbPath)}"`,
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
    ].join("\n")
}

function escapeTomlString(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
