//! Adaptive Bandwidth Management
//!
//! Monitors user activity and network usage to intelligently scale bandwidth contribution:
//! - When user is idle + low network usage → scale up to 80% contribution
//! - When user is active → scale down to 10% contribution
//! - Smooth transitions to avoid disruption

use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};

/// Minimum bandwidth to always reserve for user (Mbps)
pub const MIN_USER_RESERVE_MBPS: u32 = 20;

/// Maximum contribution percentage when idle
pub const MAX_IDLE_CONTRIBUTION_PERCENT: u8 = 80;

/// Minimum contribution percentage when active  
pub const MIN_ACTIVE_CONTRIBUTION_PERCENT: u8 = 10;

/// Seconds of inactivity before considered "idle"
pub const IDLE_THRESHOLD_SECS: u64 = 300; // 5 minutes

/// How often to check activity (seconds)
pub const ACTIVITY_CHECK_INTERVAL_SECS: u64 = 30;

/// Bandwidth measurement window (seconds)
pub const BANDWIDTH_WINDOW_SECS: u64 = 60;

#[derive(Debug, Clone)]
pub struct BandwidthState {
    /// Detected total bandwidth (Mbps)
    pub total_bandwidth_mbps: u32,
    
    /// Current user bandwidth usage (Mbps)
    pub user_usage_mbps: u32,
    
    /// Available for contribution (Mbps)
    pub available_mbps: u32,
    
    /// Current contribution rate (Mbps)
    pub contribution_mbps: u32,
    
    /// Current contribution percentage
    pub contribution_percent: u8,
    
    /// Is user currently idle
    pub is_user_idle: bool,
    
    /// Seconds since last user activity
    pub idle_seconds: u64,
    
    /// Is adaptive mode enabled
    pub adaptive_enabled: bool,
}

pub struct AdaptiveBandwidthManager {
    /// Current state
    state: Arc<RwLock<BandwidthState>>,
    
    /// Last input activity timestamp
    last_activity: Arc<RwLock<Instant>>,
    
    /// Running flag
    running: Arc<AtomicBool>,
    
    /// Bytes transferred in current window (user traffic)
    user_bytes_window: Arc<AtomicU64>,
    
    /// Bytes transferred in current window (contribution)
    contribution_bytes_window: Arc<AtomicU64>,
}

impl AdaptiveBandwidthManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(BandwidthState {
                total_bandwidth_mbps: 100, // Default, will be detected
                user_usage_mbps: 0,
                available_mbps: 90,
                contribution_mbps: 10,
                contribution_percent: MIN_ACTIVE_CONTRIBUTION_PERCENT,
                is_user_idle: false,
                idle_seconds: 0,
                adaptive_enabled: true,
            })),
            last_activity: Arc::new(RwLock::new(Instant::now())),
            running: Arc::new(AtomicBool::new(false)),
            user_bytes_window: Arc::new(AtomicU64::new(0)),
            contribution_bytes_window: Arc::new(AtomicU64::new(0)),
        }
    }
    
    /// Start the adaptive bandwidth manager
    pub async fn start(&self) {
        if self.running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }
        
        let state = self.state.clone();
        let last_activity = self.last_activity.clone();
        let running = self.running.clone();
        let user_bytes = self.user_bytes_window.clone();
        let contrib_bytes = self.contribution_bytes_window.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(ACTIVITY_CHECK_INTERVAL_SECS));
            
            while running.load(Ordering::SeqCst) {
                interval.tick().await;
                
                // Calculate idle time
                let last = *last_activity.read().await;
                let idle_secs = last.elapsed().as_secs();
                
                // Detect bandwidth usage from byte counters
                let user_mb = user_bytes.swap(0, Ordering::SeqCst) as f64 / 1_000_000.0;
                let user_mbps = (user_mb * 8.0 / ACTIVITY_CHECK_INTERVAL_SECS as f64) as u32;
                
                let contrib_mb = contrib_bytes.load(Ordering::SeqCst) as f64 / 1_000_000.0;
                let contrib_mbps = (contrib_mb * 8.0 / ACTIVITY_CHECK_INTERVAL_SECS as f64) as u32;
                
                let mut s = state.write().await;
                s.idle_seconds = idle_secs;
                s.is_user_idle = idle_secs > IDLE_THRESHOLD_SECS;
                s.user_usage_mbps = user_mbps;
                
                if s.adaptive_enabled {
                    // Calculate new contribution percentage
                    let new_percent = if s.is_user_idle && user_mbps < 5 {
                        // User is idle with low usage - scale up aggressively
                        MAX_IDLE_CONTRIBUTION_PERCENT
                    } else if s.is_user_idle {
                        // User idle but some usage - moderate contribution
                        50
                    } else if user_mbps > 20 {
                        // User is actively using bandwidth - minimum contribution
                        MIN_ACTIVE_CONTRIBUTION_PERCENT
                    } else {
                        // Light usage - medium contribution
                        30
                    };
                    
                    // Smooth transition (don't jump more than 10% at a time)
                    let current = s.contribution_percent;
                    s.contribution_percent = if new_percent > current {
                        std::cmp::min(current + 10, new_percent)
                    } else {
                        std::cmp::max(current.saturating_sub(10), new_percent)
                    };
                    
                    // Calculate actual Mbps
                    let available = s.total_bandwidth_mbps.saturating_sub(MIN_USER_RESERVE_MBPS);
                    s.available_mbps = available;
                    s.contribution_mbps = (available * s.contribution_percent as u32) / 100;
                }
                
                tracing::debug!(
                    "Bandwidth: idle={}s, user={}Mbps, contrib={}% ({}Mbps)",
                    s.idle_seconds, s.user_usage_mbps, s.contribution_percent, s.contribution_mbps
                );
            }
        });
    }
    
    /// Stop the manager
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
    
    /// Record user activity (mouse/keyboard)
    pub async fn record_activity(&self) {
        *self.last_activity.write().await = Instant::now();
    }
    
    /// Record user network bytes
    pub fn record_user_bytes(&self, bytes: u64) {
        self.user_bytes_window.fetch_add(bytes, Ordering::SeqCst);
    }
    
    /// Record contribution bytes
    pub fn record_contribution_bytes(&self, bytes: u64) {
        self.contribution_bytes_window.fetch_add(bytes, Ordering::SeqCst);
    }
    
    /// Get current state
    pub async fn get_state(&self) -> BandwidthState {
        self.state.read().await.clone()
    }
    
    /// Set total bandwidth (from speed test)
    pub async fn set_total_bandwidth(&self, mbps: u32) {
        self.state.write().await.total_bandwidth_mbps = mbps;
    }
    
    /// Enable/disable adaptive mode
    pub async fn set_adaptive_enabled(&self, enabled: bool) {
        self.state.write().await.adaptive_enabled = enabled;
    }
    
    /// Get current allowed contribution in Mbps
    pub async fn get_contribution_limit_mbps(&self) -> u32 {
        self.state.read().await.contribution_mbps
    }
    
    /// Get current contribution percentage
    pub async fn get_contribution_percent(&self) -> u8 {
        self.state.read().await.contribution_percent
    }
}

impl Default for AdaptiveBandwidthManager {
    fn default() -> Self {
        Self::new()
    }
}



