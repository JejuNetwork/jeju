//! Application state management

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::bandwidth::AdaptiveBandwidthManager;
use crate::config::VPNConfig;
use crate::contribution::ContributionManager;
use crate::dws::{DWSConfig, DWSManager};
use crate::vpn::VPNManager;

/// Main application state
pub struct AppState {
    /// VPN manager handles connections
    pub vpn: Arc<RwLock<VPNManager>>,

    /// Contribution manager handles fair sharing
    pub contribution: Arc<RwLock<ContributionManager>>,

    /// Adaptive bandwidth manager
    pub bandwidth: Arc<RwLock<AdaptiveBandwidthManager>>,

    /// DWS integration manager
    pub dws: Arc<RwLock<DWSManager>>,

    /// Configuration
    pub config: Arc<RwLock<VPNConfig>>,

    /// Current session (if authenticated)
    pub session: Arc<RwLock<Option<UserSession>>>,
}

/// User session information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UserSession {
    pub address: String,
    pub session_id: String,
    pub expires_at: u64,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vpn: Arc::new(RwLock::new(VPNManager::new())),
            contribution: Arc::new(RwLock::new(ContributionManager::new())),
            bandwidth: Arc::new(RwLock::new(AdaptiveBandwidthManager::new())),
            dws: Arc::new(RwLock::new(DWSManager::new(DWSConfig::default()))),
            config: Arc::new(RwLock::new(VPNConfig::default())),
            session: Arc::new(RwLock::new(None)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
