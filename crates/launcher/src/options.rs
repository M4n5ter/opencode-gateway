use std::error::Error;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub(crate) struct LauncherOptions {
    pub(crate) managed: bool,
    pub(crate) config_dir: Option<PathBuf>,
    pub(crate) server_host: Option<String>,
    pub(crate) server_port: Option<u16>,
}

impl LauncherOptions {
    pub(crate) fn from_env() -> Result<Self, Box<dyn Error>> {
        let managed = std::env::var("OPENCODE_GATEWAY_LAUNCHER_MANAGED")
            .map(|value| value == "1")
            .unwrap_or(false);
        let config_dir =
            std::env::var_os("OPENCODE_GATEWAY_LAUNCHER_CONFIG_DIR").map(PathBuf::from);
        let server_host = std::env::var("OPENCODE_GATEWAY_LAUNCHER_SERVER_HOST")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let server_port = std::env::var("OPENCODE_GATEWAY_LAUNCHER_SERVER_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|error| format!("invalid OPENCODE_GATEWAY_LAUNCHER_SERVER_PORT: {error}"))?;

        Ok(Self {
            managed,
            config_dir,
            server_host,
            server_port,
        })
    }
}
