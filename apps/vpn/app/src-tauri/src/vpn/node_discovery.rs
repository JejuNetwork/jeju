//! VPN node discovery

use super::{NodeCapabilities, VPNNode};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Node discovery service
pub struct NodeDiscovery {
    nodes: Arc<RwLock<Vec<VPNNode>>>,
}

impl NodeDiscovery {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Discover available VPN nodes
    pub async fn discover_nodes(
        &self,
        country_code: Option<&str>,
    ) -> Result<Vec<VPNNode>, super::VPNError> {
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

    /// Get fallback nodes for development/testing
    fn get_fallback_nodes(&self) -> Vec<VPNNode> {
        vec![
            VPNNode {
                node_id: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
                operator: "0xabcdef1234567890abcdef1234567890abcdef12".to_string(),
                country_code: "NL".to_string(),
                region: "eu-west-1".to_string(),
                endpoint: "nl1.vpn.jejunetwork.org:51820".to_string(),
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
                endpoint: "us1.vpn.jejunetwork.org:51820".to_string(),
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
                endpoint: "jp1.vpn.jejunetwork.org:51820".to_string(),
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
                endpoint: "de1.vpn.jejunetwork.org:51820".to_string(),
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
