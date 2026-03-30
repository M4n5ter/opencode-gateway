use std::error::Error;
use std::net::SocketAddr;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub(super) fn find_tcp_listeners_for_pid(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
        Err(format!("unsupported platform for TCP listener discovery: pid {pid}").into())
    }
}

pub(crate) fn find_tcp_listeners_for_pid(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    platform::find_tcp_listeners_for_pid(pid)
}
