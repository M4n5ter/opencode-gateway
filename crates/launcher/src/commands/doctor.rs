use std::error::Error;

use crate::options::LauncherOptions;
use crate::paths::{GatewayPaths, describe_path, resolve_runtime_root_path};
use crate::server::resolve_server_endpoint;

use super::report_binary;

pub(crate) fn run_doctor(options: &LauncherOptions) -> Result<(), Box<dyn Error>> {
    let paths = GatewayPaths::discover(options)?;
    let endpoint = resolve_server_endpoint(&paths, options)?;
    let runtime_root = resolve_runtime_root_path().ok();

    println!("doctor report");
    println!(
        "  runtime root: {}",
        runtime_root
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "unknown".to_owned())
    );
    println!("  gateway config: {}", describe_path(&paths.config_file));
    println!(
        "  managed opencode config: {}",
        describe_path(&paths.opencode_config_file)
    );
    println!(
        "  managed plugin loader: {}",
        describe_path(&paths.opencode_plugin_loader)
    );
    println!(
        "  gateway workspace: {}",
        describe_path(&paths.workspace_dir)
    );
    println!("  state db: {}", describe_path(&paths.state_db));
    println!("  control dir: {}", describe_path(&paths.control_dir));
    println!(
        "  managed server endpoint: {}:{} (connect via {}:{})",
        endpoint.host, endpoint.port, endpoint.connect_host, endpoint.port
    );

    report_binary("opencode", "--version");
    report_binary("bun", "--version");

    Ok(())
}
