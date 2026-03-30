use std::error::Error;
use std::ffi::{c_int, c_longlong, c_short, c_uchar, c_uint, c_ushort, c_void};
use std::mem::{self, MaybeUninit};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::ptr;

const AF_INET: c_int = 2;
const AF_INET6: c_int = 30;
const FD_TYPE_SOCKET: u32 = 2;
const IPPROTO_TCP: c_int = 6;
const PROC_PID_FD_SOCKET_INFO: c_int = 3;
const PROC_PID_LIST_FDS: c_int = 1;
const TCP_STATE_LISTEN: c_int = 1;

pub(super) fn find_tcp_listeners_for_pid(pid: u32) -> Result<Vec<SocketAddr>, Box<dyn Error>> {
    let pid = c_int::try_from(pid)?;
    let mut listeners = Vec::new();

    for fd in list_socket_fds(pid)? {
        if let Some(listener) = inspect_socket_fd(pid, fd)? {
            listeners.push(listener);
        }
    }

    Ok(listeners)
}

fn list_socket_fds(pid: c_int) -> Result<Vec<c_int>, Box<dyn Error>> {
    let buffer_size = unsafe { proc_pidinfo(pid, PROC_PID_LIST_FDS, 0, ptr::null_mut(), 0) };
    if buffer_size <= 0 {
        return Err("failed to list file descriptors".into());
    }

    let number_of_fds = usize::try_from(buffer_size)? / mem::size_of::<ProcFdInfo>();
    let mut entries = Vec::new();
    entries.resize_with(number_of_fds, ProcFdInfo::default);

    let return_code = unsafe {
        proc_pidinfo(
            pid,
            PROC_PID_LIST_FDS,
            0,
            entries.as_mut_ptr().cast::<c_void>(),
            buffer_size,
        )
    };
    if return_code <= 0 {
        return Err("failed to list file descriptors".into());
    }

    Ok(entries
        .into_iter()
        .filter(|entry| entry.proc_fd_type == FD_TYPE_SOCKET)
        .map(|entry| entry.proc_fd)
        .collect())
}

fn inspect_socket_fd(pid: c_int, fd: c_int) -> Result<Option<SocketAddr>, Box<dyn Error>> {
    let mut socket_info = MaybeUninit::<SocketFdInfo>::uninit();
    let return_code = unsafe {
        proc_pidfdinfo(
            pid,
            fd,
            PROC_PID_FD_SOCKET_INFO,
            socket_info.as_mut_ptr().cast::<c_void>(),
            c_int::try_from(mem::size_of::<SocketFdInfo>())?,
        )
    };

    if return_code <= 0 {
        return Ok(None);
    }

    let socket_info = unsafe { socket_info.assume_init() };
    socket_info.to_listening_tcp_socket()
}

unsafe extern "C" {
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;

    fn proc_pidfdinfo(
        pid: c_int,
        fd: c_int,
        flavor: c_int,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
}

#[repr(C)]
#[derive(Default)]
struct ProcFdInfo {
    proc_fd: c_int,
    proc_fd_type: u32,
}

#[repr(C)]
struct SocketFdInfo {
    _pfi: ProcFileInfo,
    psi: SocketInfo,
}

impl SocketFdInfo {
    fn to_listening_tcp_socket(&self) -> Result<Option<SocketAddr>, Box<dyn Error>> {
        let socket_info = self.psi;
        if socket_info.soi_family != AF_INET && socket_info.soi_family != AF_INET6 {
            return Ok(None);
        }

        if socket_info.soi_protocol != IPPROTO_TCP {
            return Ok(None);
        }

        let tcp_info = unsafe { socket_info.soi_proto.pri_tcp };
        if tcp_info.tcpsi_state != TCP_STATE_LISTEN {
            return Ok(None);
        }

        let addr = local_ip_addr(socket_info.soi_family, tcp_info.tcpsi_ini)?;
        let port = u16::from_be(u16::try_from(tcp_info.tcpsi_ini.insi_lport)?);
        Ok(Some(SocketAddr::new(addr, port)))
    }
}

fn local_ip_addr(family: c_int, socket_info: InSockInfo) -> Result<IpAddr, Box<dyn Error>> {
    match family {
        AF_INET => {
            let addr = unsafe { socket_info.insi_laddr.ina_46.i46a_addr4.s_addr };
            Ok(IpAddr::V4(Ipv4Addr::from(u32::from_be(addr))))
        }
        AF_INET6 => {
            let addr = unsafe { socket_info.insi_laddr.ina_6.__u6_addr.__u6_addr8 };
            Ok(IpAddr::V6(Ipv6Addr::from(addr)))
        }
        _ => Err(format!("unsupported socket family: {family}").into()),
    }
}

#[repr(C)]
struct ProcFileInfo {
    _fi_openflags: u32,
    _fi_status: u32,
    _fi_offset: c_longlong,
    _fi_type: c_int,
    _fi_guardflags: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct SocketInfo {
    _soi_stat: VinfoStat,
    _soi_so: u64,
    _soi_pcb: u64,
    _soi_type: c_int,
    soi_protocol: c_int,
    soi_family: c_int,
    _soi_options: c_short,
    _soi_linger: c_short,
    _soi_state: c_short,
    _soi_qlen: c_short,
    _soi_incqlen: c_short,
    _soi_qlimit: c_short,
    _soi_timeo: c_short,
    _soi_error: c_ushort,
    _soi_oobmark: u32,
    _soi_rcv: SockbufInfo,
    _soi_snd: SockbufInfo,
    _soi_kind: c_int,
    _rfu_1: u32,
    soi_proto: SocketInfoProtocol,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct VinfoStat {
    _vst_dev: u32,
    _vst_mode: u16,
    _vst_nlink: u16,
    _vst_ino: u64,
    _vst_uid: c_uint,
    _vst_gid: c_uint,
    _vst_atime: i64,
    _vst_atimensec: i64,
    _vst_mtime: i64,
    _vst_mtimensec: i64,
    _vst_ctime: i64,
    _vst_ctimensec: i64,
    _vst_birthtime: i64,
    _vst_birthtimensec: i64,
    _vst_size: c_longlong,
    _vst_blocks: i64,
    _vst_blksize: c_int,
    _vst_flags: u32,
    _vst_gen: u32,
    _vst_rdev: u32,
    _vst_qspare: [i64; 2],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct SockbufInfo {
    _sbi_cc: u32,
    _sbi_hiwat: u32,
    _sbi_mbcnt: u32,
    _sbi_mbmax: u32,
    _sbi_lowat: u32,
    _sbi_flags: c_short,
    _sbi_timeo: c_short,
}

#[repr(C)]
#[derive(Copy, Clone)]
union SocketInfoProtocol {
    pri_in: InSockInfo,
    pri_tcp: TcpSockInfo,
    _bindgen_union_align: [u64; 66],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct InSockInfo {
    _insi_fport: c_int,
    insi_lport: c_int,
    _insi_gencnt: u64,
    _insi_flags: u32,
    _insi_flow: u32,
    _insi_vflag: u8,
    _insi_ip_ttl: u8,
    _rfu_1: u32,
    _insi_faddr: InSockInfoAddr,
    insi_laddr: InSockInfoAddr,
    _insi_v4: InSockInfoV4,
    _insi_v6: InSockInfoV6,
}

#[repr(C)]
#[derive(Copy, Clone)]
union InSockInfoAddr {
    ina_46: In4In6Addr,
    ina_6: In6Addr,
    _bindgen_union_align: [u32; 4],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct InSockInfoV4 {
    _in4_tos: c_uchar,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct InSockInfoV6 {
    _in6_hlim: u8,
    _in6_cksum: c_int,
    _in6_ifindex: c_ushort,
    _in6_hops: c_short,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct In4In6Addr {
    _i46a_pad32: [c_uint; 3],
    i46a_addr4: InAddr,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct InAddr {
    s_addr: c_uint,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct In6Addr {
    __u6_addr: In6AddrUnion,
}

#[repr(C)]
#[derive(Copy, Clone)]
union In6AddrUnion {
    __u6_addr8: [c_uchar; 16],
    _bindgen_union_align: [u32; 4],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct TcpSockInfo {
    tcpsi_ini: InSockInfo,
    tcpsi_state: c_int,
    _tcpsi_timer: [c_int; 4],
    _tcpsi_mss: c_int,
    _tcpsi_flags: u32,
    _rfu_1: u32,
    _tcpsi_tp: u64,
}
