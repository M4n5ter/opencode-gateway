use std::error::Error;
use std::fs;
use std::io::ErrorKind;
use std::net::SocketAddr;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::Duration;

use jsonc_parser::parse_to_serde_value;
use serde::Deserialize;

use crate::http::{http_get, percent_encode};
use crate::options::LauncherOptions;
use crate::paths::GatewayPaths;
use crate::port_probe::find_tcp_listeners_for_pid;

pub(crate) const DEFAULT_SERVER_HOST: &str = "127.0.0.1";
pub(crate) const DEFAULT_SERVER_PORT: u16 = 4096;
pub(crate) const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(250);
const WARM_ATTEMPTS: usize = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServerEndpoint {
    pub(crate) host: String,
    pub(crate) connect_host: String,
    pub(crate) port: u16,
}

#[derive(Debug, Deserialize)]
struct OpencodeConfigFile {
    #[serde(default)]
    server: Option<OpencodeServerConfig>,
}

#[derive(Debug, Deserialize)]
struct OpencodeServerConfig {
    #[serde(default)]
    hostname: Option<String>,
    #[serde(default)]
    port: Option<u16>,
}

pub(crate) fn spawn_managed_opencode(paths: &GatewayPaths) -> Result<Child, Box<dyn Error>> {
    let executable = resolve_opencode_executable()?;

    Ok(Command::new(executable)
        .arg("serve")
        .env("OPENCODE_CONFIG", &paths.opencode_config_file)
        .env("OPENCODE_CONFIG_DIR", &paths.opencode_dir)
        .env("OPENCODE_GATEWAY_MANAGED", "1")
        .env("OPENCODE_GATEWAY_CONTROL_DIR", &paths.control_dir)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?)
}

fn resolve_opencode_executable() -> Result<PathBuf, Box<dyn Error>> {
    if let Some(explicit) = std::env::var_os("OPENCODE_BIN_PATH") {
        return Ok(PathBuf::from(explicit));
    }

    let resolved = resolve_path_executable("opencode").unwrap_or_else(|| PathBuf::from("opencode"));
    if let Some(native) = resolve_native_opencode_sibling(&resolved) {
        return Ok(native);
    }

    Ok(resolved)
}

fn resolve_path_executable(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;

    std::env::split_paths(&path).find_map(|entry| {
        let candidate = entry.join(name);
        if candidate.is_file() {
            return Some(fs::canonicalize(&candidate).unwrap_or(candidate));
        }

        #[cfg(windows)]
        {
            let exe_candidate = entry.join(format!("{name}.exe"));
            if exe_candidate.is_file() {
                return Some(fs::canonicalize(&exe_candidate).unwrap_or(exe_candidate));
            }
        }

        None
    })
}

fn resolve_native_opencode_sibling(path: &Path) -> Option<PathBuf> {
    let file_name = path.file_name()?.to_str()?;
    if file_name != "opencode" && file_name != "opencode.exe" {
        return None;
    }

    let parent = path.parent()?;
    let cached = parent.join(".opencode");
    if cached.is_file() {
        return Some(cached);
    }

    None
}

pub(crate) fn wait_for_child_server_endpoint(
    child: &mut Child,
) -> Result<ServerEndpoint, Box<dyn Error>> {
    let pid = child.id();

    for _ in 0..WARM_ATTEMPTS {
        if let Some(exit_status) = try_wait_running_child(child)? {
            return Err(format!(
                "opencode serve exited before its listening port was discovered: {exit_status}"
            )
            .into());
        }

        if let Some(endpoint) = inspect_listening_endpoint_for_pid(pid)? {
            return Ok(endpoint);
        }

        thread::sleep(SUPERVISOR_POLL_INTERVAL);
    }

    Err(format!("failed to discover a listening OpenCode port for pid {pid}").into())
}

pub(crate) fn wait_until_server_idle(
    child: &mut Child,
    endpoint: &ServerEndpoint,
) -> Result<(), Box<dyn Error>> {
    loop {
        if let Some(exit_status) = try_wait_running_child(child)? {
            return Err(
                format!("opencode serve exited while waiting to restart: {exit_status}").into(),
            );
        }

        if !server_has_busy_sessions(endpoint)? {
            return Ok(());
        }

        thread::sleep(SUPERVISOR_POLL_INTERVAL);
    }
}

pub(crate) fn try_wait_running_child(
    child: &mut Child,
) -> Result<Option<ExitStatus>, Box<dyn Error>> {
    match child.try_wait() {
        Ok(status) => Ok(status),
        Err(error) if error.kind() == ErrorKind::WouldBlock => Ok(None),
        Err(error) => Err(Box::new(error)),
    }
}

pub(crate) fn warm_project_instance(project_root: &Path, endpoint: &ServerEndpoint) {
    let encoded_directory = percent_encode(project_root.to_string_lossy().as_bytes());
    let request_path = format!("/experimental/tool/ids?directory={encoded_directory}");

    for _ in 0..WARM_ATTEMPTS {
        match http_get(&endpoint.connect_host, endpoint.port, &request_path) {
            Ok(response) if response.status_code == 200 => return,
            Ok(_) | Err(_) => thread::sleep(SUPERVISOR_POLL_INTERVAL),
        }
    }

    eprintln!(
        "warning: failed to warm the project instance automatically; the plugin may stay idle until the first project-scoped request"
    );
}

pub(crate) fn resolve_server_endpoint(
    paths: &GatewayPaths,
    options: &LauncherOptions,
) -> Result<ServerEndpoint, Box<dyn Error>> {
    let host = options.server_host.clone();
    let port = options.server_port;

    if host.is_some() || port.is_some() {
        let effective_host = host.as_deref().unwrap_or(DEFAULT_SERVER_HOST).to_owned();
        return Ok(ServerEndpoint {
            connect_host: normalize_connect_host(&effective_host),
            host: effective_host,
            port: port.unwrap_or(DEFAULT_SERVER_PORT),
        });
    }

    if !paths.opencode_config_file.exists() {
        return Ok(ServerEndpoint {
            host: DEFAULT_SERVER_HOST.to_owned(),
            connect_host: DEFAULT_SERVER_HOST.to_owned(),
            port: DEFAULT_SERVER_PORT,
        });
    }

    let source = fs::read_to_string(&paths.opencode_config_file)?;
    let document =
        parse_to_serde_value::<Option<OpencodeConfigFile>>(&source, &Default::default())?
            .unwrap_or(OpencodeConfigFile { server: None });
    let host = document
        .server
        .as_ref()
        .and_then(|server| server.hostname.as_ref())
        .map(|host| host.trim())
        .filter(|host| !host.is_empty())
        .unwrap_or(DEFAULT_SERVER_HOST)
        .to_owned();
    let port = document
        .server
        .as_ref()
        .and_then(|server| server.port)
        .unwrap_or(DEFAULT_SERVER_PORT);

    Ok(ServerEndpoint {
        connect_host: normalize_connect_host(&host),
        host,
        port,
    })
}

pub(crate) fn normalize_connect_host(host: &str) -> String {
    match host.trim() {
        "0.0.0.0" => "127.0.0.1".to_owned(),
        "*" => "127.0.0.1".to_owned(),
        "::" | "[::]" => "::1".to_owned(),
        value => value.to_owned(),
    }
}

fn server_has_busy_sessions(endpoint: &ServerEndpoint) -> Result<bool, Box<dyn Error>> {
    let response = http_get(&endpoint.connect_host, endpoint.port, "/session/status")?;
    if response.status_code != 200 {
        return Err(format!(
            "session status request failed with HTTP {}",
            response.status_code
        )
        .into());
    }

    let statuses: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&response.body)?;
    Ok(statuses.values().any(is_busy_session_status))
}

fn inspect_listening_endpoint_for_pid(pid: u32) -> Result<Option<ServerEndpoint>, Box<dyn Error>> {
    let mut matches = find_tcp_listeners_for_pid(pid)?;

    matches.sort_by_key(socket_priority);
    Ok(matches.into_iter().next().map(socket_to_endpoint))
}

fn is_busy_session_status(value: &serde_json::Value) -> bool {
    value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status == "busy")
}

fn socket_priority(socket: &SocketAddr) -> (u8, u16) {
    let host = socket.ip().to_string();
    let rank = if socket.ip().is_loopback() {
        0
    } else if host == "0.0.0.0" || host == "::" || host == "::0" {
        1
    } else {
        2
    };

    (rank, socket.port())
}

fn socket_to_endpoint(socket: SocketAddr) -> ServerEndpoint {
    let host = socket.ip().to_string();
    ServerEndpoint {
        connect_host: normalize_connect_host(&host),
        host,
        port: socket.port(),
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;
    use std::path::Path;

    use super::{
        ServerEndpoint, normalize_connect_host, resolve_native_opencode_sibling, socket_to_endpoint,
    };

    #[test]
    fn normalize_connect_host_maps_wildcard_hosts_to_loopback() {
        assert_eq!(normalize_connect_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(normalize_connect_host("*"), "127.0.0.1");
        assert_eq!(normalize_connect_host("::"), "::1");
        assert_eq!(normalize_connect_host("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn socket_to_endpoint_normalizes_unspecified_addresses() {
        let socket: SocketAddr = "0.0.0.0:43123".parse().expect("socket should parse");

        assert_eq!(
            socket_to_endpoint(socket),
            ServerEndpoint {
                host: "0.0.0.0".to_owned(),
                connect_host: "127.0.0.1".to_owned(),
                port: 43123,
            }
        );
    }

    #[test]
    fn resolve_native_opencode_sibling_prefers_cached_binary_next_to_wrapper() {
        let temp =
            std::env::temp_dir().join(format!("opencode-launcher-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).expect("temp dir should be created");
        std::fs::write(temp.join(".opencode"), "").expect("cached binary marker should be created");

        let wrapper = temp.join("opencode");
        assert_eq!(
            resolve_native_opencode_sibling(Path::new(&wrapper)),
            Some(temp.join(".opencode"))
        );

        let _ = std::fs::remove_dir_all(&temp);
    }
}
