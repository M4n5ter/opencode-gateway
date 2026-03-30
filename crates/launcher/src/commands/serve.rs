use std::error::Error;
use std::thread;

use opencode_gateway_core::GatewayEngine;

use crate::options::LauncherOptions;
use crate::restart::{
    RestartState, RestartStatus, clear_restart_request, now_ms, read_restart_request,
    reset_restart_control_files, write_restart_failure, write_restart_status,
};
use crate::server::{
    SUPERVISOR_POLL_INTERVAL, spawn_managed_opencode, try_wait_running_child,
    wait_for_child_server_endpoint, wait_until_server_idle, warm_project_instance,
};
use crate::workspace::build_binding_if_needed;

use super::prepare_gateway_paths;

pub(crate) fn run_serve(options: &LauncherOptions) -> Result<(), Box<dyn Error>> {
    let (paths, _) = prepare_gateway_paths(options)?;
    let engine = GatewayEngine::new();

    build_binding_if_needed()?;
    reset_restart_control_files(&paths)?;

    let status = engine.status();
    println!("starting opencode gateway");
    println!("runtime mode: {}", status.runtime_mode);
    println!("opencode config root: {}", paths.opencode_dir.display());

    let mut child = spawn_managed_opencode(&paths)?;
    let mut endpoint = wait_for_child_server_endpoint(&mut child)?;
    println!(
        "opencode server: {}:{} (connect via {}:{})",
        endpoint.host, endpoint.port, endpoint.connect_host, endpoint.port
    );
    warm_project_instance(&paths.workspace_dir, &endpoint);

    loop {
        if let Some(exit_status) = try_wait_running_child(&mut child)? {
            if !exit_status.success() {
                return Err(format!("opencode serve exited with status {exit_status}").into());
            }

            return Ok(());
        }

        if let Some(request) = read_restart_request(&paths)? {
            write_restart_status(
                &paths,
                &RestartStatus {
                    state: RestartState::Pending,
                    requested_at_ms: Some(request.requested_at_ms),
                    started_at_ms: None,
                    completed_at_ms: None,
                    last_error: None,
                },
            )?;

            wait_until_server_idle(&mut child, &endpoint)?;
            let restart_started_at_ms = now_ms()?;
            write_restart_status(
                &paths,
                &RestartStatus {
                    state: RestartState::Restarting,
                    requested_at_ms: Some(request.requested_at_ms),
                    started_at_ms: Some(restart_started_at_ms),
                    completed_at_ms: None,
                    last_error: None,
                },
            )?;

            if let Err(error) = child.kill() {
                let message = format!("failed to stop opencode serve for restart: {error}");
                write_restart_failure(
                    &paths,
                    request.requested_at_ms,
                    restart_started_at_ms,
                    &message,
                )?;
                return Err(message.into());
            }
            let _ = child.wait();

            child = match spawn_managed_opencode(&paths) {
                Ok(child) => child,
                Err(error) => {
                    let message = format!("failed to restart opencode serve: {error}");
                    write_restart_failure(
                        &paths,
                        request.requested_at_ms,
                        restart_started_at_ms,
                        &message,
                    )?;
                    return Err(message.into());
                }
            };
            endpoint = wait_for_child_server_endpoint(&mut child)?;
            warm_project_instance(&paths.workspace_dir, &endpoint);

            clear_restart_request(&paths)?;
            write_restart_status(
                &paths,
                &RestartStatus {
                    state: RestartState::Idle,
                    requested_at_ms: None,
                    started_at_ms: Some(restart_started_at_ms),
                    completed_at_ms: Some(now_ms()?),
                    last_error: None,
                },
            )?;
        }

        thread::sleep(SUPERVISOR_POLL_INTERVAL);
    }
}
