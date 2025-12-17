//! Application state management

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::VPNConfig;
use crate::contribution::ContributionManager;
use crate::vpn::{VPNConnection, VPNManager};

/// Main application state
pub struct AppState {
    /// VPN manager handles connections
    pub vpn: Arc<RwLock<VPNManager>>,
    
    /// Contribution manager handles fair sharing
    pub contribution: Arc<RwLock<ContributionManager>>,
    
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

