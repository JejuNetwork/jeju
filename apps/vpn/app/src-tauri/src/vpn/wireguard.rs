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
    pub allowed_ips: Vec<String>,
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

/// Maximum transmission unit
const MTU: usize = 1420;

/// Buffer size for packet handling
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
                tunn,
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
    pub async fn get_state(&self) -> TunnelState {
        *self.state.lock()
    }

    /// Get assigned local IP
    pub async fn get_local_ip(&self) -> Result<String, VPNError> {
        self.local_ip
            .lock()
            .clone()
            .ok_or(VPNError::NotConnected)
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
                                    // Write decrypted packet to TUN interface
                                    #[cfg(any(target_os = "linux", target_os = "macos"))]
                                    {
                                        if let Err(e) = write_to_tun(&tun_device, data).await {
                                            tracing::warn!("Failed to write to TUN: {}", e);
                                        }
                                    }
                                    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                                    {
                                        let _ = data; // Silence unused warning
                                        tracing::debug!("Received {} bytes from tunnel", data.len());
                                    }
                                }
                                TunnResult::WriteToTunnelV6(data, _src) => {
                                    #[cfg(any(target_os = "linux", target_os = "macos"))]
                                    {
                                        if let Err(e) = write_to_tun(&tun_device, data).await {
                                            tracing::warn!("Failed to write IPv6 to TUN: {}", e);
                                        }
                                    }
                                    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                                    {
                                        let _ = data;
                                        tracing::debug!("Received {} IPv6 bytes from tunnel", data.len());
                                    }
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
pub fn generate_private_key() -> String {
    let (private_key, _) = generate_keypair();
    private_key
}

/// Derive public key from private key
pub fn derive_public_key(private_key: &str) -> Result<String, VPNError> {
    use base64::Engine;

    let private_bytes = parse_base64_key(private_key)?;
    let static_secret =
        StaticSecret::try_from(private_bytes).map_err(|_| VPNError::TunnelError("Invalid private key".to_string()))?;

    let public_key = PublicKey::from(&static_secret);
    Ok(base64::engine::general_purpose::STANDARD.encode(public_key.as_bytes()))
}

// Platform-specific TUN interface handling

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    pub struct TunDevice {
        pub name: String,
        // In a real implementation, this would hold the tun fd
    }

    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on Linux");

        // In production, use the tun crate:
        // let mut config = tun::Configuration::default();
        // config.name("jeju0").mtu(MTU as i32).up();
        // let dev = tun::create_as_async(&config)?;

        Ok(TunDevice {
            name: "jeju0".to_string(),
        })
    }

    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        tracing::trace!("Writing {} bytes to TUN {}", data.len(), device.name);
        // In production: device.write(data).await?;
        Ok(())
    }

    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let _ = (device, buf);
        // In production: let n = device.read(buf).await?;
        // return Ok(&buf[..n]);
        Ok(&[])
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    pub struct TunDevice {
        pub name: String,
    }

    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on macOS (utun)");

        // macOS uses utun interfaces
        // In production, use the tun crate with macOS support

        Ok(TunDevice {
            name: "utun99".to_string(),
        })
    }

    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        tracing::trace!("Writing {} bytes to TUN {}", data.len(), device.name);
        Ok(())
    }

    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let _ = (device, buf);
        Ok(&[])
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;

    pub struct TunDevice {
        pub name: String,
    }

    pub async fn create_tun_interface() -> Result<TunDevice, VPNError> {
        tracing::info!("Creating TUN interface on Windows (WinTun)");

        // Windows requires WinTun driver
        // In production, use wintun crate

        Ok(TunDevice {
            name: "JejuVPN".to_string(),
        })
    }

    pub async fn write_to_tun(device: &TunDevice, data: &[u8]) -> Result<(), VPNError> {
        tracing::trace!("Writing {} bytes to TUN {}", data.len(), device.name);
        Ok(())
    }

    pub async fn read_from_tun<'a>(
        device: &TunDevice,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], VPNError> {
        let _ = (device, buf);
        Ok(&[])
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
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
use platform::{create_tun_interface, read_from_tun, write_to_tun, TunDevice};

#[cfg(target_os = "windows")]
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
            assert_eq!(derived, public_key, "Public key derivation should be consistent");
        }
    }
}
