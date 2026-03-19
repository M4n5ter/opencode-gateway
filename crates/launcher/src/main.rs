use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

use opencode_gateway_ffi::GatewayEngineFacade;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let command = std::env::args().nth(1);

    match command.as_deref() {
        Some("init") => run_init(),
        Some("serve") => run_serve(),
        Some("doctor") => run_doctor(),
        _ => {
            print_help();
            Ok(())
        }
    }
}

#[derive(Debug, Clone)]
struct GatewayPaths {
    config_root: PathBuf,
    config_file: PathBuf,
    opencode_dir: PathBuf,
    opencode_config_file: PathBuf,
    opencode_plugin_loader: PathBuf,
    state_dir: PathBuf,
    state_db: PathBuf,
}

impl GatewayPaths {
    fn discover() -> Result<Self, Box<dyn Error>> {
        let home = home_dir()?;
        let config_root = xdg_dir("XDG_CONFIG_HOME", &home, ".config").join("opencode-gateway");
        let state_dir = xdg_dir("XDG_DATA_HOME", &home, ".local/share").join("opencode-gateway");
        let opencode_dir = config_root.join("opencode");

        Ok(Self {
            config_file: config_root.join("config.toml"),
            opencode_config_file: opencode_dir.join("opencode.json"),
            opencode_plugin_loader: opencode_dir.join("plugins/opencode-gateway.ts"),
            state_db: state_dir.join("state.db"),
            config_root,
            opencode_dir,
            state_dir,
        })
    }
}

fn print_help() {
    println!("opencode-gateway-launcher");
    println!();
    println!("Available commands:");
    println!("  init    Prepare gateway config and managed OpenCode files");
    println!("  serve   Start OpenCode with the local gateway plugin");
    println!("  doctor  Check runtime prerequisites and generated paths");
}

fn run_init() -> Result<(), Box<dyn Error>> {
    let paths = GatewayPaths::discover()?;
    let project_root = project_root()?;

    ensure_layout(&paths)?;
    write_gateway_config_if_missing(&paths)?;
    write_managed_opencode_config(&paths)?;
    write_plugin_loader(&paths, &project_root)?;

    println!("gateway config: {}", paths.config_file.display());
    println!(
        "managed opencode config: {}",
        paths.opencode_config_file.display()
    );
    println!(
        "managed plugin loader: {}",
        paths.opencode_plugin_loader.display()
    );
    println!("state database: {}", paths.state_db.display());
    Ok(())
}

fn run_serve() -> Result<(), Box<dyn Error>> {
    let paths = GatewayPaths::discover()?;
    let project_root = project_root()?;
    let facade = GatewayEngineFacade::new();

    ensure_layout(&paths)?;
    write_gateway_config_if_missing(&paths)?;
    write_managed_opencode_config(&paths)?;
    write_plugin_loader(&paths, &project_root)?;

    let status = facade.status();
    println!("starting opencode gateway");
    println!("runtime mode: {}", status.runtime_mode);
    println!("managed config root: {}", paths.opencode_dir.display());

    let mut child = Command::new("opencode")
        .arg("serve")
        .env("OPENCODE_CONFIG", &paths.opencode_config_file)
        .env("OPENCODE_CONFIG_DIR", &paths.opencode_dir)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    let exit_status = child.wait()?;
    if !exit_status.success() {
        return Err(format!("opencode serve exited with status {exit_status}").into());
    }

    Ok(())
}

fn run_doctor() -> Result<(), Box<dyn Error>> {
    let paths = GatewayPaths::discover()?;
    let project_root = project_root()?;

    println!("doctor report");
    println!("  repo root: {}", project_root.display());
    println!("  gateway config: {}", describe_path(&paths.config_file));
    println!(
        "  managed opencode config: {}",
        describe_path(&paths.opencode_config_file)
    );
    println!(
        "  managed plugin loader: {}",
        describe_path(&paths.opencode_plugin_loader)
    );
    println!("  state db: {}", describe_path(&paths.state_db));

    report_binary("opencode", "--version");
    report_binary("bun", "--version");

    Ok(())
}

fn ensure_layout(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(&paths.config_root)?;
    fs::create_dir_all(
        paths
            .opencode_plugin_loader
            .parent()
            .expect("plugin loader parent"),
    )?;
    fs::create_dir_all(&paths.state_dir)?;
    Ok(())
}

fn write_gateway_config_if_missing(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
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
                "timezone = \"UTC\"\n",
                "state_db = \"{}\"\n\n",
                "[opencode]\n",
                "hostname = \"127.0.0.1\"\n",
                "port = 4096\n\n",
                "[cron]\n",
                "enabled = true\n",
                "tick_seconds = 5\n",
                "max_concurrent_runs = 1\n\n",
                "[channels.telegram]\n",
                "enabled = false\n",
                "bot_token_env = \"TELEGRAM_BOT_TOKEN\"\n",
                "poll_timeout_seconds = 25\n",
                "allowed_chats = []\n",
                "allowed_users = []\n"
            ),
            paths.state_db.display()
        ),
    )?;

    Ok(())
}

fn write_managed_opencode_config(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
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

fn write_plugin_loader(paths: &GatewayPaths, project_root: &Path) -> Result<(), Box<dyn Error>> {
    let plugin_entry = project_root.join("packages/opencode-plugin/src/index.ts");
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

fn report_binary(binary: &str, version_arg: &str) {
    match Command::new(binary)
        .arg(version_arg)
        .stdout(Stdio::null())
        .status()
    {
        Ok(status) if status.success() => println!("  {binary}: ok"),
        Ok(status) => println!("  {binary}: failed with status {status}"),
        Err(error) => println!("  {binary}: missing ({error})"),
    }
}

fn describe_path(path: &Path) -> String {
    if path.exists() {
        format!("present at {}", path.display())
    } else {
        format!("missing at {}", path.display())
    }
}

fn xdg_dir(env_key: &str, home: &Path, fallback: &str) -> PathBuf {
    std::env::var_os(env_key)
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(fallback))
}

fn home_dir() -> Result<PathBuf, Box<dyn Error>> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".into())
}

fn project_root() -> Result<PathBuf, Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or("failed to resolve project root")?;

    Ok(fs::canonicalize(root)?)
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{GatewayPaths, describe_path, file_url};

    #[test]
    fn discovered_paths_use_expected_filenames() {
        let paths = GatewayPaths::discover().expect("paths");

        assert!(paths.config_file.ends_with("config.toml"));
        assert!(paths.opencode_config_file.ends_with("opencode.json"));
        assert!(
            paths
                .opencode_plugin_loader
                .ends_with("plugins/opencode-gateway.ts")
        );
        assert!(paths.state_db.ends_with("state.db"));
    }

    #[test]
    fn file_urls_use_file_scheme() {
        let url = file_url(Path::new("/tmp/opencode gateway.ts"));
        assert_eq!(url, "file:///tmp/opencode%20gateway.ts");
    }

    #[test]
    fn path_description_reflects_missing_paths() {
        let description = describe_path(Path::new("/path/that/should/not/exist"));
        assert!(description.starts_with("missing at "));
    }
}
