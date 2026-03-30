use std::error::Error;

use crate::options::LauncherOptions;

use super::prepare_gateway_paths;

pub(crate) fn run_init(options: &LauncherOptions) -> Result<(), Box<dyn Error>> {
    let (paths, _) = prepare_gateway_paths(options)?;

    println!("gateway config: {}", paths.config_file.display());
    println!(
        "managed opencode config: {}",
        paths.opencode_config_file.display()
    );
    println!(
        "managed plugin loader: {}",
        paths.opencode_plugin_loader.display()
    );
    println!("gateway workspace: {}", paths.workspace_dir.display());
    println!("state database: {}", paths.state_db.display());
    Ok(())
}
