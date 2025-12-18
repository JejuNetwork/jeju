//! VPN configuration

use serde::{Deserialize, Serialize};

/// VPN application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VPNConfig {
    /// RPC URL for blockchain
    pub rpc_url: String,
    
    /// Chain ID
    pub chain_id: u64,
    
    /// VPN Registry contract address
    pub vpn_registry: String,
    
    /// Coordinator WebSocket URL
    pub coordinator_url: String,
    
    /// Default DNS servers
    pub dns_servers: Vec<String>,
    
    /// Kill switch enabled
    pub kill_switch: bool,
    
    /// Auto-connect on startup
    pub auto_connect: bool,
    
    /// Start on system boot
    pub auto_start: bool,
    
    /// Minimize to tray on close
    pub minimize_to_tray: bool,
    
    /// Show notifications
    pub show_notifications: bool,
    
    /// Adaptive bandwidth enabled
    pub adaptive_bandwidth: bool,
    
    /// Contribution settings
    pub contribution: ContributionConfig,
}

/// Contribution configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionConfig {
    /// Enable auto contribution (default true)
    pub enabled: bool,
    
    /// Max bandwidth percent to share (default 10%)
    pub max_bandwidth_percent: u8,
    
    /// Share CDN content (default true)
    pub share_cdn: bool,
    
    /// Share VPN relay where legal (default true)
    pub share_vpn_relay: bool,
    
    /// Earning mode - share more for tokens
    pub earning_mode: bool,
    
    /// Earning mode bandwidth percent (default 50%)
    pub earning_bandwidth_percent: u8,
    
    /// Schedule enabled
    pub schedule_enabled: bool,
    
    /// Schedule start time (e.g., "22:00")
    pub schedule_start: String,
    
    /// Schedule end time (e.g., "06:00")
    pub schedule_end: String,
}

impl Default for VPNConfig {
    fn default() -> Self {
        Self {
            rpc_url: "https://rpc.jeju.network".to_string(),
            chain_id: 420691,
            vpn_registry: "0x0000000000000000000000000000000000000000".to_string(),
            coordinator_url: "wss://vpn-coordinator.jeju.network".to_string(),
            dns_servers: vec!["1.1.1.1".to_string(), "8.8.8.8".to_string()],
            kill_switch: true,
            auto_connect: false,
            auto_start: false,
            minimize_to_tray: true,
            show_notifications: true,
            adaptive_bandwidth: true,
            contribution: ContributionConfig::default(),
        }
    }
}

impl Default for ContributionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_bandwidth_percent: 10,
            share_cdn: true,
            share_vpn_relay: true,
            earning_mode: false,
            earning_bandwidth_percent: 50,
            schedule_enabled: false,
            schedule_start: "22:00".to_string(),
            schedule_end: "06:00".to_string(),
        }
    }
}

