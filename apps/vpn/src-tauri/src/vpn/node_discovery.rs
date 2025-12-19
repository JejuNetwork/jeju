//! VPN node discovery via WebSocket coordinator and on-chain registry

use super::{NodeCapabilities, VPNError, VPNNode};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Messages sent to coordinator
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CoordinatorRequest {
    Subscribe { country_codes: Option<Vec<String>> },
    GetNodes { country_code: Option<String> },
    Ping { node_id: String },
    Unsubscribe,
}

/// Messages received from coordinator
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CoordinatorResponse {
    Nodes { nodes: Vec<NodeInfo> },
    NodeUpdate { node: NodeInfo },
    NodeOffline { node_id: String },
    PingResult { node_id: String, latency_ms: u32 },
    Error { message: String },
}

#[derive(Debug, Clone, Deserialize)]
struct NodeInfo {
    node_id: String,
    operator: String,
    country_code: String,
    region: String,
    endpoint: String,
    wireguard_pubkey: String,
    load: u8,
    reputation: u8,
    capabilities: NodeCapabilities,
}

impl From<NodeInfo> for VPNNode {
    fn from(info: NodeInfo) -> Self {
        VPNNode {
            node_id: info.node_id,
            operator: info.operator,
            country_code: info.country_code,
            region: info.region,
            endpoint: info.endpoint,
            wireguard_pubkey: info.wireguard_pubkey,
            latency_ms: 0, // Will be measured
            load: info.load,
            reputation: info.reputation,
            capabilities: info.capabilities,
        }
    }
}

/// Node discovery service with WebSocket connection to coordinator
pub struct NodeDiscovery {
    coordinator_url: String,
    rpc_url: String,
    nodes: Arc<RwLock<Vec<VPNNode>>>,
    ws_tx: Option<mpsc::Sender<CoordinatorRequest>>,
    connected: Arc<RwLock<bool>>,
}

impl NodeDiscovery {
    pub fn new() -> Self {
        Self {
            coordinator_url: "wss://vpn-coordinator.jeju.network".to_string(),
            rpc_url: "https://rpc.jeju.network".to_string(),
            nodes: Arc::new(RwLock::new(Vec::new())),
            ws_tx: None,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    pub fn with_config(coordinator_url: String, rpc_url: String) -> Self {
        Self {
            coordinator_url,
            rpc_url,
            nodes: Arc::new(RwLock::new(Vec::new())),
            ws_tx: None,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    /// Connect to the coordinator WebSocket
    pub async fn connect_coordinator(&mut self) -> Result<(), VPNError> {
        let url = &self.coordinator_url;
        tracing::info!("Connecting to VPN coordinator: {}", url);

        // Try to connect to WebSocket
        let ws_result = connect_async(url).await;

        match ws_result {
            Ok((ws_stream, _)) => {
                let (mut write, mut read) = ws_stream.split();
                let (tx, mut rx) = mpsc::channel::<CoordinatorRequest>(32);

                self.ws_tx = Some(tx);
                *self.connected.write().await = true;

                let nodes = self.nodes.clone();
                let connected = self.connected.clone();

                // Spawn reader task
                tokio::spawn(async move {
                    while let Some(msg) = read.next().await {
                        match msg {
                            Ok(Message::Text(text)) => {
                                if let Ok(response) =
                                    serde_json::from_str::<CoordinatorResponse>(&text)
                                {
                                    match response {
                                        CoordinatorResponse::Nodes { nodes: node_list } => {
                                            let vpn_nodes: Vec<VPNNode> =
                                                node_list.into_iter().map(Into::into).collect();
                                            *nodes.write().await = vpn_nodes;
                                            tracing::debug!(
                                                "Received {} nodes from coordinator",
                                                nodes.read().await.len()
                                            );
                                        }
                                        CoordinatorResponse::NodeUpdate { node } => {
                                            let mut nodes_lock = nodes.write().await;
                                            let vpn_node: VPNNode = node.into();
                                            if let Some(existing) = nodes_lock
                                                .iter_mut()
                                                .find(|n| n.node_id == vpn_node.node_id)
                                            {
                                                *existing = vpn_node;
                                            } else {
                                                nodes_lock.push(vpn_node);
                                            }
                                        }
                                        CoordinatorResponse::NodeOffline { node_id } => {
                                            let mut nodes_lock = nodes.write().await;
                                            nodes_lock.retain(|n| n.node_id != node_id);
                                        }
                                        CoordinatorResponse::PingResult { node_id, latency_ms } => {
                                            let mut nodes_lock = nodes.write().await;
                                            if let Some(node) =
                                                nodes_lock.iter_mut().find(|n| n.node_id == node_id)
                                            {
                                                node.latency_ms = latency_ms;
                                            }
                                        }
                                        CoordinatorResponse::Error { message } => {
                                            tracing::error!("Coordinator error: {}", message);
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => {
                                tracing::info!("Coordinator connection closed");
                                *connected.write().await = false;
                                break;
                            }
                            Err(e) => {
                                tracing::error!("WebSocket error: {}", e);
                                *connected.write().await = false;
                                break;
                            }
                            _ => {}
                        }
                    }
                });

                // Spawn writer task
                tokio::spawn(async move {
                    while let Some(request) = rx.recv().await {
                        if let Ok(json) = serde_json::to_string(&request) {
                            if write.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                });

                // Subscribe to node updates
                if let Some(ref tx) = self.ws_tx {
                    let _ = tx
                        .send(CoordinatorRequest::Subscribe {
                            country_codes: None,
                        })
                        .await;
                }

                tracing::info!("Connected to VPN coordinator");
                Ok(())
            }
            Err(e) => {
                tracing::warn!("Failed to connect to coordinator: {}, using fallback", e);
                // Fallback to mock nodes for development
                *self.nodes.write().await = self.get_fallback_nodes();
                Ok(())
            }
        }
    }

    /// Discover available VPN nodes
    pub async fn discover_nodes(
        &self,
        country_code: Option<&str>,
    ) -> Result<Vec<VPNNode>, VPNError> {
        tracing::info!("Discovering VPN nodes, country filter: {:?}", country_code);

        // If we have a WebSocket connection, request fresh nodes
        if let Some(ref tx) = self.ws_tx {
            let _ = tx
                .send(CoordinatorRequest::GetNodes {
                    country_code: country_code.map(String::from),
                })
                .await;
            // Wait a bit for response
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        let nodes = self.nodes.read().await;

        // If no nodes cached, use fallback
        if nodes.is_empty() {
            drop(nodes);
            return Ok(self.get_fallback_nodes());
        }

        // Filter by country if specified
        let filtered = if let Some(code) = country_code {
            nodes
                .iter()
                .filter(|n| n.country_code == code)
                .cloned()
                .collect()
        } else {
            nodes.clone()
        };

        Ok(filtered)
    }

    /// Ping a node to measure latency
    pub async fn ping_node(&self, node_id: &str) -> Result<u32, VPNError> {
        if let Some(ref tx) = self.ws_tx {
            let _ = tx
                .send(CoordinatorRequest::Ping {
                    node_id: node_id.to_string(),
                })
                .await;

            // Wait for ping result
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            let nodes = self.nodes.read().await;
            if let Some(node) = nodes.iter().find(|n| n.node_id == node_id) {
                return Ok(node.latency_ms);
            }
        }

        // Fallback: do a simple HTTP ping
        let start = std::time::Instant::now();
        let nodes = self.nodes.read().await;
        if let Some(node) = nodes.iter().find(|n| n.node_id == node_id) {
            // Try to connect to the endpoint
            let endpoint = &node.endpoint;
            if let Ok(addr) = endpoint.parse::<std::net::SocketAddr>() {
                match tokio::time::timeout(
                    tokio::time::Duration::from_secs(5),
                    tokio::net::TcpStream::connect(addr),
                )
                .await
                {
                    Ok(Ok(_)) => return Ok(start.elapsed().as_millis() as u32),
                    _ => {}
                }
            }
        }

        Ok(100) // Default fallback latency
    }

    /// Get node details from contract
    pub async fn get_node_details(&self, node_id: &str) -> Result<VPNNode, VPNError> {
        let nodes = self.nodes.read().await;
        nodes
            .iter()
            .find(|n| n.node_id == node_id)
            .cloned()
            .ok_or_else(|| VPNError::DiscoveryError(format!("Node {} not found", node_id)))
    }

    /// Get fallback nodes for development/testing
    fn get_fallback_nodes(&self) -> Vec<VPNNode> {
        vec![
            VPNNode {
                node_id: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
                operator: "0xabcdef1234567890abcdef1234567890abcdef12".to_string(),
                country_code: "NL".to_string(),
                region: "eu-west-1".to_string(),
                endpoint: "nl1.vpn.jeju.network:51820".to_string(),
                wireguard_pubkey: "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Qga2V5".to_string(),
                latency_ms: 25,
                load: 30,
                reputation: 95,
                capabilities: NodeCapabilities {
                    supports_wireguard: true,
                    supports_socks5: true,
                    supports_http: true,
                    serves_cdn: true,
                    is_vpn_exit: true,
                },
            },
            VPNNode {
                node_id: "0xabcdef1234567890abcdef1234567890abcdef12".to_string(),
                operator: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
                country_code: "US".to_string(),
                region: "us-east-1".to_string(),
                endpoint: "us1.vpn.jeju.network:51820".to_string(),
                wireguard_pubkey: "YW5vdGhlciB0ZXN0IGtleSBmb3IgdGVzdGluZw==".to_string(),
                latency_ms: 80,
                load: 45,
                reputation: 90,
                capabilities: NodeCapabilities {
                    supports_wireguard: true,
                    supports_socks5: true,
                    supports_http: true,
                    serves_cdn: true,
                    is_vpn_exit: true,
                },
            },
            VPNNode {
                node_id: "0x9876543210fedcba9876543210fedcba98765432".to_string(),
                operator: "0xfedcba9876543210fedcba9876543210fedcba98".to_string(),
                country_code: "JP".to_string(),
                region: "ap-northeast-1".to_string(),
                endpoint: "jp1.vpn.jeju.network:51820".to_string(),
                wireguard_pubkey: "amFwYW4gdGVzdCBrZXkgZm9yIHRlc3RpbmcgdnBu".to_string(),
                latency_ms: 150,
                load: 20,
                reputation: 98,
                capabilities: NodeCapabilities {
                    supports_wireguard: true,
                    supports_socks5: true,
                    supports_http: true,
                    serves_cdn: true,
                    is_vpn_exit: true,
                },
            },
            VPNNode {
                node_id: "0x5555555555555555555555555555555555555555".to_string(),
                operator: "0x6666666666666666666666666666666666666666".to_string(),
                country_code: "DE".to_string(),
                region: "eu-central-1".to_string(),
                endpoint: "de1.vpn.jeju.network:51820".to_string(),
                wireguard_pubkey: "Z2VybWFueSB0ZXN0IGtleSBmb3IgdGVzdGluZw==".to_string(),
                latency_ms: 35,
                load: 55,
                reputation: 92,
                capabilities: NodeCapabilities {
                    supports_wireguard: true,
                    supports_socks5: true,
                    supports_http: true,
                    serves_cdn: true,
                    is_vpn_exit: true,
                },
            },
        ]
    }
}

impl Default for NodeDiscovery {
    fn default() -> Self {
        Self::new()
    }
}
