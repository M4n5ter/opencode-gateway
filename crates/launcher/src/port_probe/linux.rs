use std::collections::HashSet;
use std::error::Error;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};

pub(super) fn find_tcp_listeners_for_pid(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let socket_inodes = read_socket_inodes_for_pid(pid)?;
    if socket_inodes.is_empty() {
        return Ok(Vec::new());
    }

    let mut listeners = Vec::new();
    listeners.extend(read_tcp_table("/proc/net/tcp", &socket_inodes)?);
    listeners.extend(read_tcp6_table("/proc/net/tcp6", &socket_inodes)?);
    Ok(listeners)
}

fn read_socket_inodes_for_pid(pid: u32) -> Result<HashSet<u64>, Box<dyn Error>> {
    let fd_dir = PathBuf::from(format!("/proc/{pid}/fd"));
    let mut inodes = HashSet::new();

    for entry in fs::read_dir(fd_dir)? {
        let Ok(entry) = entry else {
            continue;
        };

        let Ok(link) = fs::read_link(entry.path()) else {
            continue;
        };

        if let Some(inode) = parse_socket_inode(&link) {
            inodes.insert(inode);
        }
    }

    Ok(inodes)
}

fn parse_socket_inode(link: &Path) -> Option<u64> {
    let link = link.to_string_lossy();
    let inode = link.strip_prefix("socket:[")?.strip_suffix(']')?;
    inode.parse::<u64>().ok()
}

fn read_tcp_table(
    path: &str,
    socket_inodes: &HashSet<u64>,
) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(Box::new(error)),
    };

    let mut listeners = Vec::new();
    for line in source.lines().skip(1) {
        if let Some((socket, inode)) = parse_tcp_table_entry(line)? {
            if socket_inodes.contains(&inode) {
                listeners.push(socket);
            }
        }
    }

    Ok(listeners)
}

fn read_tcp6_table(
    path: &str,
    socket_inodes: &HashSet<u64>,
) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(Box::new(error)),
    };

    let mut listeners = Vec::new();
    for line in source.lines().skip(1) {
        if let Some((socket, inode)) = parse_tcp6_table_entry(line)? {
            if socket_inodes.contains(&inode) {
                listeners.push(socket);
            }
        }
    }

    Ok(listeners)
}

fn parse_tcp_table_entry(line: &str) -> Result<Option<(SocketAddr, u64)>, Box<dyn Error>> {
    let fields = line.split_whitespace().collect::<Vec<_>>();
    if fields.len() <= 9 || fields[3] != "0A" {
        return Ok(None);
    }

    let (ip_hex, port_hex) = split_local_address(fields[1])?;
    let ip = u32::from_str_radix(ip_hex, 16)?;
    let port = u16::from_str_radix(port_hex, 16)?;
    let socket = SocketAddr::new(IpAddr::V4(Ipv4Addr::from(u32::from_be(ip))), port);
    let inode = fields[9].parse::<u64>()?;

    Ok(Some((socket, inode)))
}

fn parse_tcp6_table_entry(line: &str) -> Result<Option<(SocketAddr, u64)>, Box<dyn Error>> {
    let fields = line.split_whitespace().collect::<Vec<_>>();
    if fields.len() <= 9 || fields[3] != "0A" {
        return Ok(None);
    }

    let (ip_hex, port_hex) = split_local_address(fields[1])?;
    let ip = parse_ipv6_hex(ip_hex)?;
    let port = u16::from_str_radix(port_hex, 16)?;
    let socket = SocketAddr::new(IpAddr::V6(ip), port);
    let inode = fields[9].parse::<u64>()?;

    Ok(Some((socket, inode)))
}

fn split_local_address(value: &str) -> Result<(&str, &str), Box<dyn Error>> {
    value
        .split_once(':')
        .ok_or_else(|| format!("invalid socket address entry: {value}").into())
}

fn parse_ipv6_hex(hex: &str) -> Result<Ipv6Addr, Box<dyn Error>> {
    if hex.len() != 32 {
        return Err(format!("invalid IPv6 entry length: {hex}").into());
    }

    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()?;

    let words = bytes
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes(chunk.try_into().expect("chunk length is fixed")))
        .collect::<Vec<_>>();

    Ok(Ipv6Addr::new(
        ((words[0] >> 16) & 0xffff) as u16,
        (words[0] & 0xffff) as u16,
        ((words[1] >> 16) & 0xffff) as u16,
        (words[1] & 0xffff) as u16,
        ((words[2] >> 16) & 0xffff) as u16,
        (words[2] & 0xffff) as u16,
        ((words[3] >> 16) & 0xffff) as u16,
        (words[3] & 0xffff) as u16,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_socket_inode_extracts_socket_targets() {
        assert_eq!(
            parse_socket_inode(&PathBuf::from("socket:[2142703]")),
            Some(2_142_703)
        );
        assert_eq!(parse_socket_inode(&PathBuf::from("/tmp/file")), None);
    }

    #[test]
    fn parse_tcp_table_entry_extracts_listen_socket() {
        let line = "0: 0100007F:B0E5 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 2142703 1 0000000000000000 100 0 0 10 0";
        let (socket, inode) = parse_tcp_table_entry(line)
            .expect("line should parse")
            .expect("line should be a listener");

        assert_eq!(
            socket,
            "127.0.0.1:45285".parse().expect("socket should parse")
        );
        assert_eq!(inode, 2_142_703);
    }

    #[test]
    fn parse_tcp6_table_entry_extracts_listen_socket() {
        let line = "0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 99999 1 0000000000000000 100 0 0 10 0";
        let (socket, inode) = parse_tcp6_table_entry(line)
            .expect("line should parse")
            .expect("line should be a listener");

        assert_eq!(socket, "[::1]:8080".parse().expect("socket should parse"));
        assert_eq!(inode, 99_999);
    }
}
