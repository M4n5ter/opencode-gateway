mod commands;
mod http;
mod options;
mod paths;
mod port_probe;
mod restart;
mod server;
mod workspace;

use std::error::Error;
use std::process::ExitCode;

use options::LauncherOptions;

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
    let options = LauncherOptions::from_env()?;

    match command.as_deref() {
        Some("init") => commands::run_init(&options),
        Some("serve") => commands::run_serve(&options),
        Some("doctor") => commands::run_doctor(&options),
        Some("warm") => commands::run_warm(&options),
        _ => {
            print_help();
            Ok(())
        }
    }
}

fn print_help() {
    println!("opencode-gateway-launcher");
    println!();
    println!("Available commands:");
    println!("  init    Prepare gateway config and managed OpenCode files");
    println!("  warm    Warm the gateway plugin for the configured workspace");
    println!("  serve   Start OpenCode with the local gateway plugin");
    println!("  doctor  Check runtime prerequisites and generated paths");
}
