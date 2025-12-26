//! Adaptive Bandwidth Management
//!
//! Monitors user activity and network usage to scale bandwidth contribution.

use std::sync::Arc;
use tokio::sync::RwLock;

/// Minimum contribution percentage when active  
pub const MIN_ACTIVE_CONTRIBUTION_PERCENT: u8 = 10;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BandwidthState {
    pub total_bandwidth_mbps: u32,
    pub user_usage_mbps: u32,
    pub available_mbps: u32,
    pub contribution_mbps: u32,
    pub contribution_percent: u8,
    pub is_user_idle: bool,
    pub idle_seconds: u64,
    pub adaptive_enabled: bool,
}

pub struct AdaptiveBandwidthManager {
    state: Arc<RwLock<BandwidthState>>,
}

impl AdaptiveBandwidthManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(BandwidthState {
                total_bandwidth_mbps: 100,
                user_usage_mbps: 0,
                available_mbps: 90,
                contribution_mbps: 10,
                contribution_percent: MIN_ACTIVE_CONTRIBUTION_PERCENT,
                is_user_idle: false,
                idle_seconds: 0,
                adaptive_enabled: true,
            })),
        }
    }

    pub fn state_arc(&self) -> Arc<RwLock<BandwidthState>> {
        self.state.clone()
    }
}

impl Default for AdaptiveBandwidthManager {
    fn default() -> Self {
        Self::new()
    }
}
