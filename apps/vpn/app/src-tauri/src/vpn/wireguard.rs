//! WireGuard tunnel implementation using Cloudflare's boringtun
//!
//! This module provides a userspace WireGuard implementation that:
//! - Uses boringtun for WireGuard protocol handling
//! - Manages TUN interface for packet capture
//! - Handles encryption/decryption of packets
//! - Manages handshakes and timers

use super::VPNError;
use boringtun::noise::{Tunn, TunnResult};
use boringtun::x25519::{PublicKey, StaticSecret};
use parking_lot::Mutex;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

/// WireGuard configuration
#[derive(Debug, Clone)]
pub struct WireGuardConfig {
    pub private_key: String,
    pub peer_pubkey: String,
    pub endpoint: String,
    #[allow(dead_code)]
    pub allowed_ips: Vec<String>,
    #[allow(dead_code)]
    pub dns: Vec<String>,
    pub keepalive: u16,
}

/// WireGuard tunnel state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

/// Maximum transmission unit for WireGuard packets
#[allow(dead_code)]
const MTU: usize = 1420;

/// Buffer size for packet handling (must be > MTU + overhead)
const BUFFER_SIZE: usize = 2048;

/// WireGuard tunnel manager using boringtun
pub struct WireGuardTunnel {
    config: WireGuardConfig,
    state: Arc<Mutex<TunnelState>>,
    running: Arc<AtomicBool>,

    // Statistics
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    packets_up: Arc<AtomicU64>,
    packets_down: Arc<AtomicU64>,

    // Assigned IP
    local_ip: Arc<Mutex<Option<String>>>,

    // Shutdown signal
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl WireGuardTunnel {
    /// Create a new WireGuard tunnel
    pub async fn new(config: WireGuardConfig) -> Result<Self, VPNError> {
        Ok(Self {
            config,
            state: Arc::new(Mutex::new(TunnelState::Stopped)),
            running: Arc::new(AtomicBool::new(false)),
            bytes_up: Arc::new(AtomicU64::new(0)),
            bytes_down: Arc::new(AtomicU64::new(0)),
            packets_up: Arc::new(AtomicU64::new(0)),
            packets_down: Arc::new(AtomicU64::new(0)),
            local_ip: Arc::new(Mutex::new(None)),
            shutdown_tx: None,
        })
    }

    /// Start the WireGuard tunnel
    pub async fn start(&mut self) -> Result<(), VPNError> {
        *self.state.lock() = TunnelState::Starting;

        tracing::info!("Starting WireGuard tunnel to {}", self.config.endpoint);

        // Parse keys
        let private_key = parse_base64_key(&self.config.private_key)?;
        let peer_pubkey = parse_base64_key(&self.config.peer_pubkey)?;

        let static_secret = StaticSecret::try_from(private_key)
            .map_err(|_| VPNError::TunnelError("Invalid private key".to_string()))?;

        let peer_public = PublicKey::from(peer_pubkey);

        // Create boringtun tunnel
        let tunn = Tunn::new(
            static_secret,
            peer_public,
            None, // Pre-shared key (optional)
            Some(self.config.keepalive),
            0,    // Tunnel index
            None, // Rate limiter (optional)
        )
        .map_err(|e| VPNError::TunnelError(format!("Failed to create tunnel: {:?}", e)))?;

        // Parse endpoint
        let endpoint: SocketAddr = self
            .config
            .endpoint
            .parse()
            .map_err(|e| VPNError::TunnelError(format!("Invalid endpoint: {}", e)))?;

        // Create UDP socket for WireGuard traffic
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| VPNError::TunnelError(format!("Failed to bind UDP socket: {}", e)))?;

        socket
            .set_nonblocking(true)
            .map_err(|e| VPNError::TunnelError(format!("Failed to set non-blocking: {}", e)))?;

        socket
            .connect(endpoint)
            .map_err(|e| VPNError::TunnelError(format!("Failed to connect to endpoint: {}", e)))?;

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx);

        // Start the tunnel processing task
        let running = self.running.clone();
        let state = self.state.clone();
        let bytes_up = self.bytes_up.clone();
        let bytes_down = self.bytes_down.clone();
        let packets_up = self.packets_up.clone();
        let packets_down = self.packets_down.clone();
        let local_ip = self.local_ip.clone();

        running.store(true, Ordering::SeqCst);

        tokio::spawn(async move {
            if let Err(e) = run_tunnel_loop(
                Box::new(tunn),
                socket,
                running.clone(),
                bytes_up,
                bytes_down,
                packets_up,
                packets_down,
                local_ip,
                shutdown_rx,
            )
            .await
            {
                tracing::error!("Tunnel loop error: {}", e);
                *state.lock() = TunnelState::Error;
            }

            running.store(false, Ordering::SeqCst);
            *state.lock() = TunnelState::Stopped;
        });

        *self.state.lock() = TunnelState::Running;
        tracing::info!("WireGuard tunnel started successfully");

        Ok(())
    }

    /// Stop the tunnel
    pub async fn stop(&mut self) -> Result<(), VPNError> {
        *self.state.lock() = TunnelState::Stopping;
        tracing::info!("Stopping WireGuard tunnel");

        self.running.store(false, Ordering::SeqCst);

        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }

        // Wait a bit for clean shutdown
        tokio::time::sleep(Duration::from_millis(100)).await;

        *self.state.lock() = TunnelState::Stopped;
        *self.local_ip.lock() = None;

        tracing::info!("WireGuard tunnel stopped");
        Ok(())
    }

    /// Get tunnel state
    #[allow(dead_code)]
    pub async fn get_state(&self) -> TunnelState {
        *self.state.lock()
    }

    /// Get assigned local IP
    pub async fn get_local_ip(&self) -> Result<String, VPNError> {
        self.local_ip.lock().clone().ok_or(VPNError::NotConnected)
    }

    /// Get transfer statistics (bytes up, bytes down)
    pub async fn get_transfer_stats(&self) -> Result<(u64, u64), VPNError> {
        let up = self.bytes_up.load(Ordering::Relaxed);
        let down = self.bytes_down.load(Ordering::Relaxed);
        Ok((up, down))
    }

    /// Get packet statistics (packets up, packets down)
    pub async fn get_packet_stats(&self) -> Result<(u64, u64), VPNError> {
        let up = self.packets_up.load(Ordering::Relaxed);
        let down = self.packets_down.load(Ordering::Relaxed);
        Ok((up, down))
    }

    /// Record bytes transferred (for external tracking)
    #[allow(dead_code)]
    pub async fn record_transfer(&self, bytes_up: u64, bytes_down: u64) {
        self.bytes_up.fetch_add(bytes_up, Ordering::Relaxed);
        self.bytes_down.fetch_add(bytes_down, Ordering::Relaxed);
        self.packets_up.fetch_add(1, Ordering::Relaxed);
        self.packets_down.fetch_add(1, Ordering::Relaxed);
    }
}

/// Main tunnel processing loop
async fn run_tunnel_loop(
    tunn: Box<Tunn>,
    socket: UdpSocket,
    running: Arc<AtomicBool>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    packets_up: Arc<AtomicU64>,
    packets_down: Arc<AtomicU64>,
    local_ip: Arc<Mutex<Option<String>>>,
    mut shutdown_rx: mpsc::Receiver<()>,
) -> Result<(), VPNError> {
    let tunn = Arc::new(Mutex::new(tunn));
    let socket = Arc::new(socket);

    // Create TUN interface
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let tun_device = create_tun_interface().await?;

    // Set a placeholder IP (will be assigned by server in real implementation)
    *local_ip.lock() = Some("10.0.0.2".to_string());

    // Buffer for receiving data
    let mut recv_buf = [0u8; BUFFER_SIZE];
    let mut send_buf = [0u8; BUFFER_SIZE];

    // Initiate handshake
    {
        let mut tunn_guard = tunn.lock();
        match tunn_guard.format_handshake_initiation(&mut send_buf, false) {
            TunnResult::WriteToNetwork(data) => {
                if let Err(e) = socket.send(data) {
                    tracing::warn!("Failed to send handshake initiation: {}", e);
                }
            }
            _ => {}
        }
    }

    // Timer tick interval for keepalive and handshake management
    let mut timer_interval = tokio::time::interval(Duration::from_millis(250));

    loop {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        tokio::select! {
            // Check for shutdown signal
            _ = shutdown_rx.recv() => {
                tracing::info!("Received shutdown signal");
                break;
            }

            // Timer tick for boringtun
            _ = timer_interval.tick() => {
                let mut tunn_guard = tunn.lock();
                match tunn_guard.update_timers(&mut send_buf) {
                    TunnResult::WriteToNetwork(data) => {
                        if let Err(e) = socket.send(data) {
                            tracing::warn!("Failed to send timer packet: {}", e);
                        }
                    }
                    TunnResult::Err(e) => {
                        tracing::warn!("Timer update error: {:?}", e);
                    }
                    _ => {}
                }
            }

            // Process incoming UDP packets from WireGuard peer
            _ = tokio::task::yield_now() => {
                match socket.recv(&mut recv_buf) {
                    Ok(n) if n > 0 => {
                        bytes_down.fetch_add(n as u64, Ordering::Relaxed);
                        packets_down.fetch_add(1, Ordering::Relaxed);

                        // Collect data to write while holding lock, then release before async writes
                        let mut tun_writes: Vec<Vec<u8>> = Vec::new();
                        {
                            let mut tunn_guard = tunn.lock();
                            let mut result = tunn_guard.decapsulate(None, &recv_buf[..n], &mut send_buf);

                            loop {
                                match result {
                                    TunnResult::WriteToNetwork(data) => {
                                        if let Err(e) = socket.send(data) {
                                            tracing::warn!("Failed to send response: {}", e);
                                        }
                                        bytes_up.fetch_add(data.len() as u64, Ordering::Relaxed);
                                        packets_up.fetch_add(1, Ordering::Relaxed);
                                    }
                                    TunnResult::WriteToTunnelV4(data, _src) => {
                                        tun_writes.push(data.to_vec());
                                    }
                                    TunnResult::WriteToTunnelV6(data, _src) => {
                                        tun_writes.push(data.to_vec());
                                    }
                                    TunnResult::Done => break,
                                    TunnResult::Err(e) => {
                                        tracing::warn!("Decapsulation error: {:?}", e);
                                        break;
                                    }
                                }

                                // Check if there's more data to process
                                result = tunn_guard.decapsulate(None, &[], &mut send_buf);
                            }
                        } // tunn_guard dropped here

                        // Now perform async TUN writes without holding the lock
                        #[cfg(any(target_os = "linux", target_os = "macos"))]
                        for data in tun_writes {
                            if let Err(e) = write_to_tun(&tun_device, &data).await {
                                tracing::warn!("Failed to write to TUN: {}", e);
                            }
                        }
                        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                        for data in tun_writes {
                            tracing::debug!("Received {} bytes from tunnel", data.len());
                        }
                    }
                    Ok(_) => {}
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // No data available, yield
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                    Err(e) => {
                        tracing::warn!("Socket receive error: {}", e);
                    }
                }
            }
        }

        // Read from TUN and encapsulate for sending
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            if let Ok(data) = read_from_tun(&tun_device, &mut recv_buf).await {
                if !data.is_empty() {
                    let mut tunn_guard = tunn.lock();
                    match tunn_guard.encapsulate(data, &mut send_buf) {
                        TunnResult::WriteToNetwork(encrypted) => {
                            if let Err(e) = socket.send(encrypted) {
                                tracing::warn!("Failed to send encapsulated packet: {}", e);
                            }
                            bytes_up.fetch_add(encrypted.len() as u64, Ordering::Relaxed);
                            packets_up.fetch_add(1, Ordering::Relaxed);
                        }
                        TunnResult::Err(e) => {
                            tracing::warn!("Encapsulation error: {:?}", e);
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    tracing::info!("Tunnel loop ended");
    Ok(())
}

/// Parse a base64-encoded 32-byte key
fn parse_base64_key(key: &str) -> Result<[u8; 32], VPNError> {
    use base64::Engine;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(key)
        .map_err(|e| VPNError::TunnelError(format!("Invalid base64 key: {}", e)))?;

    if decoded.len() != 32 {
        return Err(VPNError::TunnelError(format!(
            "Key must be 32 bytes, got {}",
            decoded.len()
        )));
    }

    let mut key_array = [0u8; 32];
    key_array.copy_from_slice(&decoded);
    Ok(key_array)
}

/// Generate a new WireGuard keypair using boringtun's x25519
pub fn generate_keypair() -> (String, String) {
    use base64::Engine;
    use rand::RngCore;

    let mut private_key_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut private_key_bytes);

    let static_secret = StaticSecret::try_from(private_key_bytes).expect("Valid key bytes");
    let public_key = PublicKey::from(&static_secret);

    let private_key = base64::engine::general_purpose::STANDARD.encode(private_key_bytes);
    let public_key = base64::engine::general_purpose::STANDARD.encode(public_key.as_bytes());

    (private_key, public_key)
}

/// Generate just a private key
#[allow(dead_code)]
pub fn generate_private_key() -> String {
    let (private_key, _) = generate_keypair();
    private_key
}

/// Derive public key from private key
#[allow(dead_code)]
pub fn derive_public_key(private_key: &str) -> Result<String, VPNError> {
    use base64::Engine;

    let private_bytes = parse_base64_key(private_key)?;
    let static_secret = StaticSecret::try_from(private_bytes)
        .map_err(|_| VPNError::TunnelError("Invalid private key".to_string()))?;

    let public_key = PublicKey::from(&static_secret);
    Ok(base64::engine::general_purpose::STANDARD.encode(public_key.as_bytes()))
}

// Platform-specific TUN interface handling using the `tun` crate for Linux/macOS
// and `wintun` crate for Windows.

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tun::Device;

    pub struct TunDevice {
        pub name: String,
        device: Arc<Mutex<tun::platform::Device>>,
    }

    /// Create a TUN interface on Linux using the tun crate
    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on Linux");

        let mut config = tun::Configuration::default();
        config
            .name("jeju0")
            .mtu(MTU as i32)
            .address((10, 0, 0, 2))
            .netmask((255, 255, 255, 0))
            .up();

        #[cfg(target_os = "linux")]
        config.platform(|config| {
            config.packet_information(true);
        });

        let device = tun::create(&config)
            .map_err(|e| VPNError::TunnelError(format!("Failed to create TUN device: {}", e)))?;

        let name = device
            .name()
            .map_err(|e| VPNError::TunnelError(format!("Failed to get TUN device name: {}", e)))?;

        tracing::info!("Created TUN interface: {}", name);

        Ok(TunDevice {
            name,
            device: Arc::new(Mutex::new(device)),
        })
    }

    /// Write data to the TUN device
    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        let mut dev = device.device.lock().await;
        dev.write_all(data)
            .map_err(|e| VPNError::TunnelError(format!("Failed to write to TUN: {}", e)))?;
        tracing::trace!("Wrote {} bytes to TUN {}", data.len(), device.name);
        Ok(())
    }

    /// Read data from the TUN device
    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let mut dev = device.device.lock().await;

        // Use non-blocking read
        match dev.read(buf) {
            Ok(n) if n > 0 => {
                tracing::trace!("Read {} bytes from TUN {}", n, device.name);
                Ok(&buf[..n])
            }
            Ok(_) => Ok(&[]),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(&[]),
            Err(e) => Err(VPNError::TunnelError(format!(
                "Failed to read from TUN: {}",
                e
            ))),
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tun::Device;

    pub struct TunDevice {
        pub name: String,
        device: Arc<Mutex<tun::platform::Device>>,
    }

    /// Create a TUN interface on macOS using the tun crate (utun)
    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on macOS (utun)");

        let mut config = tun::Configuration::default();
        config
            .mtu(MTU as i32)
            .address((10, 0, 0, 2))
            .netmask((255, 255, 255, 0))
            .up();

        let device = tun::create(&config)
            .map_err(|e| VPNError::TunnelError(format!("Failed to create utun device: {}", e)))?;

        let name = device
            .name()
            .map_err(|e| VPNError::TunnelError(format!("Failed to get utun device name: {}", e)))?;

        tracing::info!("Created utun interface: {}", name);

        Ok(TunDevice {
            name,
            device: Arc::new(Mutex::new(device)),
        })
    }

    /// Write data to the utun device
    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        let mut dev = device.device.lock().await;
        dev.write_all(data)
            .map_err(|e| VPNError::TunnelError(format!("Failed to write to utun: {}", e)))?;
        tracing::trace!("Wrote {} bytes to utun {}", data.len(), device.name);
        Ok(())
    }

    /// Read data from the utun device
    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let mut dev = device.device.lock().await;

        match dev.read(buf) {
            Ok(n) if n > 0 => {
                tracing::trace!("Read {} bytes from utun {}", n, device.name);
                Ok(&buf[..n])
            }
            Ok(_) => Ok(&[]),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(&[]),
            Err(e) => Err(VPNError::TunnelError(format!(
                "Failed to read from utun: {}",
                e
            ))),
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::Arc;

    pub struct TunDevice {
        pub name: String,
        session: Arc<wintun::Session>,
    }

    /// Create a TUN interface on Windows using the wintun crate
    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on Windows (WinTun)");

        // Load the WinTun DLL
        let wintun = unsafe { wintun::load() }
            .map_err(|e| VPNError::TunnelError(format!("Failed to load WinTun: {}", e)))?;

        // Create adapter
        let adapter =
            wintun::Adapter::create(&wintun, "JejuVPN", "JejuVPN", None).map_err(|e| {
                VPNError::TunnelError(format!("Failed to create WinTun adapter: {}", e))
            })?;

        // Set IP address using netsh (WinTun doesn't do this automatically)
        let output = std::process::Command::new("netsh")
            .args([
                "interface",
                "ip",
                "set",
                "address",
                "name=JejuVPN",
                "static",
                "10.0.0.2",
                "255.255.255.0",
            ])
            .output();

        if let Err(e) = output {
            tracing::warn!("Failed to set IP address: {}", e);
        }

        // Start session
        let session = adapter
            .start_session(wintun::MAX_RING_CAPACITY)
            .map_err(|e| VPNError::TunnelError(format!("Failed to start WinTun session: {}", e)))?;

        tracing::info!("Created WinTun interface: JejuVPN");

        Ok(TunDevice {
            name: "JejuVPN".to_string(),
            session: Arc::new(session),
        })
    }

    /// Write data to the WinTun device
    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        let mut packet = device
            .session
            .allocate_send_packet(data.len() as u16)
            .map_err(|e| {
                VPNError::TunnelError(format!("Failed to allocate WinTun packet: {}", e))
            })?;

        packet.bytes_mut().copy_from_slice(data);
        device.session.send_packet(packet);

        tracing::trace!("Wrote {} bytes to WinTun {}", data.len(), device.name);
        Ok(())
    }

    /// Read data from the WinTun device
    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        match device.session.try_receive() {
            Ok(Some(packet)) => {
                let len = packet.bytes().len().min(buf.len());
                buf[..len].copy_from_slice(&packet.bytes()[..len]);
                tracing::trace!("Read {} bytes from WinTun {}", len, device.name);
                Ok(&buf[..len])
            }
            Ok(None) => Ok(&[]),
            Err(e) => Err(VPNError::TunnelError(format!(
                "Failed to read from WinTun: {}",
                e
            ))),
        }
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use super::*;
    use std::os::fd::RawFd;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// TUN device wrapper for iOS using NetworkExtension
    /// On iOS, the tunnel file descriptor is provided by NEPacketTunnelProvider
    /// which must be implemented in Swift and passed to Rust via FFI
    pub struct TunDevice {
        pub name: String,
        fd: Arc<Mutex<Option<RawFd>>>,
    }

    impl TunDevice {
        /// Create a new TunDevice with a file descriptor from NEPacketTunnelProvider
        pub fn with_fd(fd: RawFd) -> Self {
            Self {
                name: "utun".to_string(),
                fd: Arc::new(Mutex::new(Some(fd))),
            }
        }
    }

    /// Create a TUN interface on iOS
    /// Note: On iOS, the actual TUN is created by NEPacketTunnelProvider in Swift
    /// This function creates a placeholder that expects set_tun_fd to be called
    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating iOS TUN interface placeholder");
        tracing::info!("Note: iOS requires NEPacketTunnelProvider to provide the tunnel fd");
        
        Ok(TunDevice {
            name: "utun".to_string(),
            fd: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        let fd_guard = device.fd.lock().await;
        let fd = fd_guard.ok_or_else(|| {
            VPNError::TunnelError("iOS TUN fd not set - NEPacketTunnelProvider required".to_string())
        })?;
        
        // Use libc write for raw fd
        let result = unsafe { libc::write(fd, data.as_ptr() as *const libc::c_void, data.len()) };
        if result < 0 {
            return Err(VPNError::TunnelError("Failed to write to iOS TUN".to_string()));
        }
        
        Ok(())
    }

    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let fd_guard = device.fd.lock().await;
        let fd = fd_guard.ok_or_else(|| {
            VPNError::TunnelError("iOS TUN fd not set - NEPacketTunnelProvider required".to_string())
        })?;
        
        let result = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        if result < 0 {
            return Err(VPNError::TunnelError("Failed to read from iOS TUN".to_string()));
        }
        
        Ok(&buf[..result as usize])
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::*;
    use std::os::fd::RawFd;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// TUN device wrapper for Android using VpnService
    /// On Android, the tunnel file descriptor is provided by VpnService.Builder
    /// which must be implemented in Kotlin/Java and passed to Rust via JNI
    pub struct TunDevice {
        pub name: String,
        fd: Arc<Mutex<Option<RawFd>>>,
    }

    impl TunDevice {
        /// Create a new TunDevice with a file descriptor from VpnService
        pub fn with_fd(fd: RawFd) -> Self {
            Self {
                name: "tun0".to_string(),
                fd: Arc::new(Mutex::new(Some(fd))),
            }
        }
    }

    /// Create a TUN interface on Android
    /// Note: On Android, the actual TUN is created by VpnService in Kotlin/Java
    /// This function creates a placeholder that expects set_tun_fd to be called
    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating Android TUN interface placeholder");
        tracing::info!("Note: Android requires VpnService to provide the tunnel fd");
        
        Ok(TunDevice {
            name: "tun0".to_string(),
            fd: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        let fd_guard = device.fd.lock().await;
        let fd = fd_guard.ok_or_else(|| {
            VPNError::TunnelError("Android TUN fd not set - VpnService required".to_string())
        })?;
        
        let result = unsafe { libc::write(fd, data.as_ptr() as *const libc::c_void, data.len()) };
        if result < 0 {
            return Err(VPNError::TunnelError("Failed to write to Android TUN".to_string()));
        }
        
        Ok(())
    }

    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let fd_guard = device.fd.lock().await;
        let fd = fd_guard.ok_or_else(|| {
            VPNError::TunnelError("Android TUN fd not set - VpnService required".to_string())
        })?;
        
        let result = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        if result < 0 {
            return Err(VPNError::TunnelError("Failed to read from Android TUN".to_string()));
        }
        
        Ok(&buf[..result as usize])
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows", target_os = "ios", target_os = "android")))]
mod platform {
    use super::*;

    pub struct TunDevice;

    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }

    pub async fn write_to_tun(_device: &TunDevice, _data: &[u8]) -> Result<(), VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }

    pub async fn read_from_tun<'a>(
        _device: &TunDevice,
        _buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
use platform::{create_tun_interface, read_from_tun, write_to_tun};

#[cfg(target_os = "windows")]
use platform::TunDevice;

#[cfg(any(target_os = "ios", target_os = "android"))]
use platform::TunDevice;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let (private_key, public_key) = generate_keypair();

        // Keys should be valid base64
        assert!(!private_key.is_empty());
        assert!(!public_key.is_empty());

        // Should be able to derive public from private
        let derived = derive_public_key(&private_key).expect("Should derive public key");
        assert_eq!(derived, public_key);
    }

    #[test]
    fn test_parse_base64_key() {
        // Valid 32-byte key encoded as base64
        let valid_key = "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Qga2V5"; // "hello world this is a test key" truncated to 32 bytes

        // This won't work because the string is wrong length
        // Let's use a properly generated key
        let (private_key, _) = generate_keypair();
        let result = parse_base64_key(&private_key);
        assert!(result.is_ok());
    }

    #[test]
    fn test_keypair_derivation_consistency() {
        for _ in 0..10 {
            let (private_key, public_key) = generate_keypair();
            let derived = derive_public_key(&private_key).expect("Should derive");
            assert_eq!(
                derived, public_key,
                "Public key derivation should be consistent"
            );
        }
    }
}
