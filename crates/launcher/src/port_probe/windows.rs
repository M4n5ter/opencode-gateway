use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::ptr;
use std::slice;

use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCP_STATE_LISTEN, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
    MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
};

const AF_INET: u32 = 2;
const AF_INET6: u32 = 23;
const NO_ERROR: u32 = 0;

pub(super) fn find_tcp_listeners_for_pid(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let mut listeners = Vec::new();
    listeners.extend(read_ipv4_listeners(pid)?);
    listeners.extend(read_ipv6_listeners(pid)?);
    Ok(listeners)
}

fn read_ipv4_listeners(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let table = read_tcp_table(AF_INET)?;
    if table.len() < std::mem::size_of::<MIB_TCPTABLE_OWNER_PID>() {
        return Ok(Vec::new());
    }

    #[allow(clippy::cast_ptr_alignment)]
    let table = unsafe { &*(table.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>()) };
    let rows = unsafe {
        slice::from_raw_parts(
            std::ptr::addr_of!(table.table[0]),
            table.dwNumEntries as usize,
        )
    };

    Ok(rows
        .iter()
        .filter(|row| row.dwOwningPid == pid && row.dwState == MIB_TCP_STATE_LISTEN as u32)
        .map(socket_addr_from_tcp_row)
        .collect())
}

fn read_ipv6_listeners(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let table = read_tcp_table(AF_INET6)?;
    if table.len() < std::mem::size_of::<MIB_TCP6TABLE_OWNER_PID>() {
        return Ok(Vec::new());
    }

    #[allow(clippy::cast_ptr_alignment)]
    let table = unsafe { &*(table.as_ptr().cast::<MIB_TCP6TABLE_OWNER_PID>()) };
    let rows = unsafe {
        slice::from_raw_parts(
            std::ptr::addr_of!(table.table[0]),
            table.dwNumEntries as usize,
        )
    };

    Ok(rows
        .iter()
        .filter(|row| row.dwOwningPid == pid && row.dwState == MIB_TCP_STATE_LISTEN as u32)
        .map(socket_addr_from_tcp6_row)
        .collect())
}

fn read_tcp_table(address_family: u32) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut table_size = 0u32;
    let mut status = unsafe {
        GetExtendedTcpTable(
            ptr::null_mut(),
            &mut table_size,
            0,
            address_family,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        )
    };

    let mut table = Vec::new();
    let mut attempts = 0;
    while status == ERROR_INSUFFICIENT_BUFFER {
        table.resize(table_size as usize, 0);
        status = unsafe {
            GetExtendedTcpTable(
                table.as_mut_ptr().cast(),
                &mut table_size,
                0,
                address_family,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            )
        };
        attempts += 1;
        if attempts > 8 {
            return Err("failed to allocate TCP table buffer".into());
        }
    }

    if status != NO_ERROR {
        return Err(format!("GetExtendedTcpTable failed with error code {status}").into());
    }

    table.truncate(table_size as usize);
    Ok(table)
}

fn socket_addr_from_tcp_row(row: &MIB_TCPROW_OWNER_PID) -> SocketAddr {
    let port = u16::from_be(row.dwLocalPort as u16);
    SocketAddr::new(
        IpAddr::V4(Ipv4Addr::from(u32::from_be(row.dwLocalAddr))),
        port,
    )
}

fn socket_addr_from_tcp6_row(row: &MIB_TCP6ROW_OWNER_PID) -> SocketAddr {
    let port = u16::from_be(row.dwLocalPort as u16);
    SocketAddr::new(IpAddr::V6(Ipv6Addr::from(row.ucLocalAddr)), port)
}
