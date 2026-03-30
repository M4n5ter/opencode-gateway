mod doctor;
mod init;
mod serve;
mod warm;

use std::error::Error;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::options::LauncherOptions;
use crate::paths::{GatewayPaths, resolve_plugin_entry_path};
use crate::workspace::{
    ensure_layout, write_gateway_config_if_missing, write_managed_opencode_config_if_missing,
    write_plugin_loader, write_workspace_scaffold_if_missing,
};

pub(crate) use doctor::run_doctor;
pub(crate) use init::run_init;
pub(crate) use serve::run_serve;
pub(crate) use warm::run_warm;

fn prepare_gateway_paths(
    options: &LauncherOptions,
) -> Result<(GatewayPaths, PathBuf), Box<dyn Error>> {
    let paths = GatewayPaths::discover(options)?;
    let plugin_entry = resolve_plugin_entry_path()?;

    ensure_layout(&paths)?;
    write_workspace_scaffold_if_missing(&paths)?;
    write_gateway_config_if_missing(&paths)?;
    write_managed_opencode_config_if_missing(&paths)?;
    write_plugin_loader(&paths, &plugin_entry)?;

    Ok((paths, plugin_entry))
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
