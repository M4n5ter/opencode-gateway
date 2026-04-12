use std::error::Error;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::paths::{resolve_runtime_root_path, GatewayPaths};

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
                "allowed_users = []\n",
                "allowed_bot_users = []\n\n",
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
    let template_root = resolve_workspace_template_root_path()?;
    copy_directory_contents_if_missing(&template_root, &paths.workspace_dir)?;
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

fn resolve_workspace_template_root_path() -> Result<std::path::PathBuf, Box<dyn Error>> {
    let runtime_root = resolve_runtime_root_path()?;
    let candidates = [
        runtime_root.join("templates/workspace"),
        runtime_root.join("packages/opencode-plugin/templates/workspace"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("failed to resolve workspace template root".into())
}

fn copy_directory_contents_if_missing(
    source_dir: &Path,
    target_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(target_dir)?;

    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target_dir.join(entry.file_name());
        let metadata = entry.metadata()?;

        if metadata.is_dir() {
            copy_directory_contents_if_missing(&source_path, &target_path)?;
            continue;
        }

        if metadata.is_file() {
            copy_file_if_missing(&source_path, &target_path)?;
        }
    }

    Ok(())
}

fn copy_file_if_missing(source_path: &Path, target_path: &Path) -> Result<(), Box<dyn Error>> {
    if target_path.exists() {
        return Ok(());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(source_path, target_path)?;
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
