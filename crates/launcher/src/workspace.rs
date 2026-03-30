use std::error::Error;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::paths::{GatewayPaths, resolve_runtime_root_path};

pub(crate) fn ensure_layout(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(&paths.config_root)?;
    fs::create_dir_all(&paths.workspace_dir)?;
    fs::create_dir_all(
        paths
            .opencode_plugin_loader
            .parent()
            .expect("plugin loader parent"),
    )?;
    fs::create_dir_all(&paths.control_dir)?;
    fs::create_dir_all(&paths.state_dir)?;
    Ok(())
}

pub(crate) fn write_gateway_config_if_missing(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
    if paths.config_file.exists() {
        return Ok(());
    }

    fs::write(
        &paths.config_file,
        format!(
            concat!(
                "# Opencode Gateway configuration\n",
                "# Fill in secrets and provider details before enabling real integrations.\n\n",
                "[gateway]\n",
                "state_db = \"{}\"\n\n",
                "[cron]\n",
                "enabled = true\n",
                "tick_seconds = 5\n",
                "max_concurrent_runs = 1\n",
                "# timezone = \"Asia/Shanghai\"\n\n",
                "[channels.telegram]\n",
                "enabled = false\n",
                "# Ask @BotFather for the bot token. Choose exactly one credential source.\n",
                "# bot_token = \"123456:ABCDEF\"\n",
                "# Or load it from an environment variable:\n",
                "bot_token_env = \"TELEGRAM_BOT_TOKEN\"\n",
                "poll_timeout_seconds = 25\n",
                "# Ask @userinfobot for your numeric Telegram user id for private-chat allowlists.\n",
                "allowed_chats = []\n",
                "allowed_users = []\n\n",
                "# Optional long-lived memory sources injected into gateway-managed sessions.\n",
                "# Relative paths are resolved from opencode-gateway-workspace.\n",
                "# Missing files and directories are created automatically.\n",
                "# The workspace also prepares `.opencode/skills/` for workspace-local OpenCode skills.\n\n",
                "[[memory.entries]]\n",
                "path = \"USER.md\"\n",
                "description = \"Persistent user profile and preference memory. Keep this file accurate and concise. Record stable preferences, communication style, workflow habits, project conventions, tool constraints, review expectations, and other recurring facts that should shape future assistance. Update it proactively when you learn something durable about the user. Do not store one-off task details or transient context here.\"\n",
                "inject_content = true\n\n",
                "[[memory.entries]]\n",
                "path = \"RULES.md\"\n",
                "description = \"Behavior rules and standing operating constraints for the assistant. Keep this file concise, explicit, and current. Use it for durable expectations about behavior, review standards, output style, safety boundaries, and other rules that should consistently shape future responses. Update it proactively when new long-lived rules or boundaries become clear.\"\n",
                "inject_content = true\n\n",
                "[[memory.entries]]\n",
                "path = \"memory/daily\"\n",
                "description = \"Daily notes stored as YYYY-MM-DD.md files. Use this directory for dated logs, short-lived findings, and day-specific working context that should remain searchable without being auto-injected. Create or update the current day's file proactively when meaningful new day-specific context appears.\"\n",
                "search_only = true\n"
            ),
            paths.state_db.display()
        ),
    )?;

    Ok(())
}

pub(crate) fn write_managed_opencode_config_if_missing(
    paths: &GatewayPaths,
) -> Result<(), Box<dyn Error>> {
    if paths.opencode_config_file.exists() {
        return Ok(());
    }

    fs::write(
        &paths.opencode_config_file,
        concat!(
            "{\n",
            "  \"$schema\": \"https://opencode.ai/config.json\",\n",
            "  \"server\": {\n",
            "    \"hostname\": \"127.0.0.1\",\n",
            "    \"port\": 4096\n",
            "  }\n",
            "}\n"
        ),
    )?;

    Ok(())
}

pub(crate) fn write_workspace_scaffold_if_missing(
    paths: &GatewayPaths,
) -> Result<(), Box<dyn Error>> {
    write_file_if_missing(
        &paths.workspace_dir.join("USER.md"),
        concat!(
            "# USER\n\n",
            "Use this file for durable user profile and preference memory.\n\n",
            "- Update it proactively when you learn a stable preference, workflow habit, review expectation, or recurring constraint.\n",
            "- Keep it concise and deduplicated.\n",
            "- Do not store one-off task details or day-specific notes here.\n",
        ),
    )?;
    write_file_if_missing(
        &paths.workspace_dir.join("RULES.md"),
        concat!(
            "# RULES\n\n",
            "Use this file for durable assistant behavior rules and standing operating constraints.\n\n",
            "- Update it proactively when a new long-lived rule, boundary, or style expectation becomes clear.\n",
            "- Keep it explicit, concise, and deduplicated.\n",
            "- Do not mix day-specific task notes into this file.\n",
        ),
    )?;
    write_file_if_missing(
        &paths.workspace_dir.join("memory/daily/README.md"),
        concat!(
            "# Daily Notes\n\n",
            "Store day-specific notes here as `YYYY-MM-DD.md` files.\n\n",
            "Use daily notes for dated progress logs, investigation breadcrumbs, temporary decisions, and other context that should remain searchable without becoming durable user or rules memory.\n\n",
            "Create or update the current day's file proactively when there is meaningful new day-specific context to preserve.\n",
        ),
    )?;
    write_file_if_missing(
        &paths.workspace_dir.join(".opencode/skills/README.md"),
        concat!(
            "# Workspace Skills\n\n",
            "Put gateway-local OpenCode skills in this directory.\n\n",
            "Gateway-managed sessions default to this workspace-local `.opencode/skills` directory when creating, installing, or updating skills.\n\n",
            "OpenCode may still read globally configured skills, but new or maintained gateway skills should live here unless the user explicitly asks for a global change.\n",
        ),
    )?;

    Ok(())
}

pub(crate) fn write_plugin_loader(
    paths: &GatewayPaths,
    plugin_entry: &Path,
) -> Result<(), Box<dyn Error>> {
    let plugin_entry = fs::canonicalize(plugin_entry)?;
    let plugin_url = file_url(&plugin_entry);

    fs::write(
        &paths.opencode_plugin_loader,
        format!(
            concat!(
                "// Generated by opencode-gateway-launcher.\n",
                "// OpenCode loads this file through OPENCODE_CONFIG_DIR.\n",
                "export {{ default, OpencodeGatewayPlugin }} from \"{}\";\n"
            ),
            plugin_url
        ),
    )?;

    Ok(())
}

pub(crate) fn build_binding_if_needed() -> Result<(), Box<dyn Error>> {
    if std::env::var_os("OPENCODE_GATEWAY_PACKAGE_ROOT").is_some() {
        return Ok(());
    }

    let project_root = resolve_runtime_root_path()?;
    let status = Command::new("bun")
        .arg("run")
        .arg("build:binding")
        .current_dir(&project_root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()?;

    if !status.success() {
        return Err(format!("bun run build:binding exited with status {status}").into());
    }

    Ok(())
}

fn write_file_if_missing(path: &Path, contents: &str) -> Result<(), Box<dyn Error>> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, contents)?;
    Ok(())
}

fn file_url(path: &Path) -> String {
    let mut value = String::from("file://");
    value.push_str(
        &path
            .to_string_lossy()
            .replace('\\', "/")
            .replace(' ', "%20"),
    );
    value
}
