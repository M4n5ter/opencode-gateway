use std::error::Error;

use crate::options::LauncherOptions;
use crate::server::{resolve_server_endpoint, warm_project_instance};

use super::prepare_gateway_paths;

pub(crate) fn run_warm(options: &LauncherOptions) -> Result<(), Box<dyn Error>> {
    let (paths, _) = prepare_gateway_paths(options)?;
    let endpoint = resolve_server_endpoint(&paths, options)?;
    warm_project_instance(&paths.workspace_dir, &endpoint);

    println!(
        "gateway plugin warmed: http://{}:{}",
        endpoint.connect_host, endpoint.port
    );
    println!("warm directory: {}", paths.workspace_dir.display());
    Ok(())
}
