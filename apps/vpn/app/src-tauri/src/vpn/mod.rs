//! VPN core functionality

mod node_discovery;
mod tunnel;
mod wireguard;

pub use node_discovery::*;
pub use tunnel::*;
pub use wireguard::*;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// VPN connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

/// VPN node information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VPNNode {
    pub node_id: String,
    pub operator: String,
    pub country_code: String,
    pub region: String,
    pub endpoint: String,
    pub wireguard_pubkey: String,
    pub latency_ms: u32,
    pub load: u8,
    pub reputation: u8,
    pub capabilities: NodeCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCapabilities {
    pub supports_wireguard: bool,
    pub supports_socks5: bool,
    pub supports_http: bool,
    pub serves_cdn: bool,
    pub is_vpn_exit: bool,
}

/// Active VPN connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VPNConnection {
    pub connection_id: String,
    pub status: ConnectionStatus,
    pub node: VPNNode,
    pub connected_at: Option<u64>,
    pub local_ip: Option<String>,
    pub public_ip: Option<String>,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub latency_ms: u32,
}

/// Connection statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStats {
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub packets_up: u64,
    pub packets_down: u64,
    pub connected_seconds: u64,
    pub latency_ms: u32,
}

/// VPN Manager - handles all VPN operations
pub struct VPNManager {
    /// Current connection (if any)
    connection: Option<VPNConnection>,

    /// WireGuard tunnel
    tunnel: Option<WireGuardTunnel>,

    /// Node discovery
    discovery: NodeDiscovery,

    /// Available nodes cache
    nodes: Vec<VPNNode>,

    /// Selected node ID
    selected_node_id: Option<String>,
}

impl VPNManager {
    pub fn new() -> Self {
        Self {
            connection: None,
            tunnel: None,
            discovery: NodeDiscovery::new(),
            nodes: Vec::new(),
            selected_node_id: None,
        }
    }

    /// Connect to VPN
    pub async fn connect(&mut self, node: Option<VPNNode>) -> Result<VPNConnection, VPNError> {
        // Get node to connect to
        let target_node = match node {
            Some(n) => n,
            None => {
                // Use selected node or find best one
                if let Some(ref id) = self.selected_node_id {
                    self.nodes
                        .iter()
                        .find(|n| n.node_id == *id)
                        .cloned()
                        .ok_or(VPNError::NoNodeSelected)?
                } else {
                    self.find_best_node().await?
                }
            }
        };

        tracing::info!(
            "Connecting to VPN node: {} ({})",
            target_node.node_id,
            target_node.country_code
        );

        // Create WireGuard config
        let wg_config = WireGuardConfig {
            private_key: generate_private_key(),
            peer_pubkey: target_node.wireguard_pubkey.clone(),
            endpoint: target_node.endpoint.clone(),
            allowed_ips: vec!["0.0.0.0/0".to_string(), "::/0".to_string()],
            dns: vec!["1.1.1.1".to_string(), "8.8.8.8".to_string()],
            keepalive: 25,
        };

        // Create and start tunnel
        let tunnel = WireGuardTunnel::new(wg_config).await?;
        tunnel.start().await?;

        // Get assigned IP
        let local_ip = tunnel.get_local_ip().await?;

        // Create connection
        let connection = VPNConnection {
            connection_id: uuid::Uuid::new_v4().to_string(),
            status: ConnectionStatus::Connected,
            node: target_node,
            connected_at: Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
            ),
            local_ip: Some(local_ip),
            public_ip: None, // Will be fetched async
            bytes_up: 0,
            bytes_down: 0,
            latency_ms: 0,
        };

        self.tunnel = Some(tunnel);
        self.connection = Some(connection.clone());

        tracing::info!("VPN connected successfully");
        Ok(connection)
    }

    /// Disconnect from VPN
    pub async fn disconnect(&mut self) -> Result<(), VPNError> {
        if let Some(mut tunnel) = self.tunnel.take() {
            tunnel.stop().await?;
        }

        self.connection = None;
        tracing::info!("VPN disconnected");
        Ok(())
    }

    /// Get current connection status
    pub fn get_status(&self) -> ConnectionStatus {
        self.connection
            .as_ref()
            .map(|c| c.status)
            .unwrap_or(ConnectionStatus::Disconnected)
    }

    /// Get current connection
    pub fn get_connection(&self) -> Option<&VPNConnection> {
        self.connection.as_ref()
    }

    /// Get connection statistics
    pub async fn get_stats(&self) -> Option<ConnectionStats> {
        let conn = self.connection.as_ref()?;
        let tunnel = self.tunnel.as_ref()?;

        let (bytes_up, bytes_down) = tunnel.get_transfer_stats().await.ok()?;
        let (packets_up, packets_down) = tunnel.get_packet_stats().await.ok()?;

        let connected_seconds = conn
            .connected_at
            .map(|t| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    - t
            })
            .unwrap_or(0);

        Some(ConnectionStats {
            bytes_up,
            bytes_down,
            packets_up,
            packets_down,
            connected_seconds,
            latency_ms: conn.latency_ms,
        })
    }

    /// Select a specific node
    pub fn select_node(&mut self, node_id: String) {
        self.selected_node_id = Some(node_id);
    }

    /// Get available nodes
    pub async fn get_nodes(
        &mut self,
        country_code: Option<String>,
    ) -> Result<Vec<VPNNode>, VPNError> {
        // Refresh nodes from discovery
        self.nodes = self
            .discovery
            .discover_nodes(country_code.as_deref())
            .await?;
        Ok(self.nodes.clone())
    }

    /// Find best node based on latency and load
    async fn find_best_node(&mut self) -> Result<VPNNode, VPNError> {
        if self.nodes.is_empty() {
            self.nodes = self.discovery.discover_nodes(None).await?;
        }

        self.nodes
            .iter()
            .filter(|n| n.capabilities.is_vpn_exit)
            .min_by_key(|n| n.latency_ms as u32 + n.load as u32 * 10)
            .cloned()
            .ok_or(VPNError::NoNodesAvailable)
    }
}

impl Default for VPNManager {
    fn default() -> Self {
        Self::new()
    }
}

/// VPN errors
#[derive(Debug, thiserror::Error)]
pub enum VPNError {
    #[error("No VPN node selected")]
    NoNodeSelected,

    #[error("No VPN nodes available")]
    NoNodesAvailable,

    #[error("Failed to create tunnel: {0}")]
    TunnelError(String),

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Discovery failed: {0}")]
    DiscoveryError(String),

    #[error("Not connected")]
    NotConnected,

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Generate a new WireGuard private key
fn generate_private_key() -> String {
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key)
}
