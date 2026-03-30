use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use crate::options::LauncherOptions;

#[derive(Debug, Clone)]
pub(crate) struct GatewayPaths {
    pub(crate) config_root: PathBuf,
    pub(crate) config_file: PathBuf,
    pub(crate) workspace_dir: PathBuf,
    pub(crate) opencode_dir: PathBuf,
    pub(crate) control_dir: PathBuf,
    pub(crate) opencode_config_file: PathBuf,
    pub(crate) opencode_plugin_loader: PathBuf,
    pub(crate) state_dir: PathBuf,
    pub(crate) state_db: PathBuf,
    pub(crate) restart_request_file: PathBuf,
    pub(crate) restart_status_file: PathBuf,
}

impl GatewayPaths {
    pub(crate) fn discover(options: &LauncherOptions) -> Result<Self, Box<dyn Error>> {
        let home = home_dir()?;
        let config_root = xdg_dir("XDG_CONFIG_HOME", &home, ".config").join("opencode-gateway");
        let state_dir = xdg_dir("XDG_DATA_HOME", &home, ".local/share").join("opencode-gateway");
        let opencode_dir = resolve_cli_config_dir(options, &home)?;
        let config_file = opencode_dir.join("opencode-gateway.toml");

        Ok(Self {
            workspace_dir: config_file
                .parent()
                .expect("gateway config parent")
                .join("opencode-gateway-workspace"),
            control_dir: opencode_dir.join("control"),
            config_file,
            opencode_config_file: resolve_opencode_config_path(&opencode_dir),
            opencode_plugin_loader: opencode_dir.join("plugins/opencode-gateway.ts"),
            restart_request_file: opencode_dir.join("control/restart-request.json"),
            restart_status_file: opencode_dir.join("control/restart-status.json"),
            state_db: state_dir.join("state.db"),
            config_root,
            opencode_dir,
            state_dir,
        })
    }
}

pub(crate) fn describe_path(path: &Path) -> String {
    if path.exists() {
        format!("present at {}", path.display())
    } else {
        format!("missing at {}", path.display())
    }
}

pub(crate) fn resolve_runtime_root_path() -> Result<PathBuf, Box<dyn Error>> {
    if let Some(package_root) = std::env::var_os("OPENCODE_GATEWAY_PACKAGE_ROOT") {
        return Ok(fs::canonicalize(package_root)?);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or("failed to resolve project root")?;

    Ok(fs::canonicalize(root)?)
}

pub(crate) fn resolve_plugin_entry_path() -> Result<PathBuf, Box<dyn Error>> {
    let root = resolve_runtime_root_path()?;
    let packaged = root.join("dist/index.js");
    if packaged.exists() {
        return Ok(packaged);
    }

    Ok(root.join("packages/opencode-plugin/src/index.ts"))
}

fn home_dir() -> Result<PathBuf, Box<dyn Error>> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".into())
}

fn xdg_dir(env_key: &str, home: &Path, fallback: &str) -> PathBuf {
    std::env::var_os(env_key).map_or_else(|| home.join(fallback), PathBuf::from)
}

fn resolve_cli_config_dir(
    options: &LauncherOptions,
    home: &Path,
) -> Result<PathBuf, Box<dyn Error>> {
    if let Some(config_dir) = &options.config_dir {
        return Ok(fs::canonicalize(config_dir).unwrap_or_else(|_| config_dir.clone()));
    }

    if options.managed {
        return Ok(xdg_dir("XDG_CONFIG_HOME", home, ".config").join("opencode-gateway/opencode"));
    }

    Ok(std::env::var_os("OPENCODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| xdg_dir("XDG_CONFIG_HOME", home, ".config").join("opencode")))
}

fn resolve_opencode_config_path(config_dir: &Path) -> PathBuf {
    let jsonc = config_dir.join("opencode.jsonc");
    if jsonc.exists() {
        return jsonc;
    }

    let json = config_dir.join("opencode.json");
    if json.exists() {
        return json;
    }

    jsonc
}
