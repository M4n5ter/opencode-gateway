use std::error::Error;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::paths::GatewayPaths;

#[derive(Debug, Deserialize)]
pub(crate) struct RestartRequest {
    #[serde(rename = "requestedAtMs")]
    pub(crate) requested_at_ms: u64,
    #[serde(rename = "requestedBy")]
    _requested_by: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RestartState {
    Idle,
    Pending,
    Restarting,
    Failed,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RestartStatus {
    pub(crate) state: RestartState,
    #[serde(rename = "requestedAtMs", skip_serializing_if = "Option::is_none")]
    pub(crate) requested_at_ms: Option<u64>,
    #[serde(rename = "startedAtMs", skip_serializing_if = "Option::is_none")]
    pub(crate) started_at_ms: Option<u64>,
    #[serde(rename = "completedAtMs", skip_serializing_if = "Option::is_none")]
    pub(crate) completed_at_ms: Option<u64>,
    #[serde(rename = "lastError", skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
}

pub(crate) fn now_ms() -> Result<u64, Box<dyn Error>> {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH)?;
    Ok(elapsed.as_millis() as u64)
}

pub(crate) fn reset_restart_control_files(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
    if paths.restart_request_file.exists() {
        fs::remove_file(&paths.restart_request_file)?;
    }

    write_restart_status(
        paths,
        &RestartStatus {
            state: RestartState::Idle,
            requested_at_ms: None,
            started_at_ms: None,
            completed_at_ms: None,
            last_error: None,
        },
    )
}

pub(crate) fn read_restart_request(
    paths: &GatewayPaths,
) -> Result<Option<RestartRequest>, Box<dyn Error>> {
    read_json_file(&paths.restart_request_file)
}

pub(crate) fn clear_restart_request(paths: &GatewayPaths) -> Result<(), Box<dyn Error>> {
    if paths.restart_request_file.exists() {
        fs::remove_file(&paths.restart_request_file)?;
    }

    Ok(())
}

pub(crate) fn write_restart_status(
    paths: &GatewayPaths,
    status: &RestartStatus,
) -> Result<(), Box<dyn Error>> {
    fs::write(
        &paths.restart_status_file,
        format!("{}\n", serde_json::to_string_pretty(status)?),
    )?;
    Ok(())
}

pub(crate) fn write_restart_failure(
    paths: &GatewayPaths,
    requested_at_ms: u64,
    started_at_ms: u64,
    message: &str,
) -> Result<(), Box<dyn Error>> {
    clear_restart_request(paths)?;
    write_restart_status(
        paths,
        &RestartStatus {
            state: RestartState::Failed,
            requested_at_ms: Some(requested_at_ms),
            started_at_ms: Some(started_at_ms),
            completed_at_ms: Some(now_ms()?),
            last_error: Some(message.to_owned()),
        },
    )
}

fn read_json_file<T>(path: &Path) -> Result<Option<T>, Box<dyn Error>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.exists() {
        return Ok(None);
    }

    let source = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&source)?))
}
