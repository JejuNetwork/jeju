//! Contribution system for fair sharing
//!
//! Model:
//! - Free VPN that's never limited
//! - Users contribute up to 10% of idle bandwidth
//! - Contribution capped at 3x their VPN usage
//! - Contribution includes: CDN serving + VPN relay (where legal)

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Contribution multiplier - max contribution is 3x usage
pub const CONTRIBUTION_MULTIPLIER: u64 = 3;

/// Default bandwidth percent to share when idle
pub const DEFAULT_BANDWIDTH_PERCENT: u8 = 10;

/// Contribution status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionStatus {
    /// Total VPN bytes used this period
    pub vpn_bytes_used: u64,
    
    /// Total bytes contributed this period
    pub bytes_contributed: u64,
    
    /// Contribution cap (vpn_bytes_used * 3)
    pub contribution_cap: u64,
    
    /// Remaining quota before cap is reached
    pub quota_remaining: u64,
    
    /// Currently contributing
    pub is_contributing: bool,
    
    /// Contribution paused by user
    pub is_paused: bool,
    
    /// CDN bytes served
    pub cdn_bytes_served: u64,
    
    /// VPN relay bytes served
    pub relay_bytes_served: u64,
    
    /// Period start timestamp
    pub period_start: u64,
    
    /// Period end timestamp (monthly reset)
    pub period_end: u64,
}

/// Contribution settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionSettings {
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

impl Default for ContributionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            max_bandwidth_percent: DEFAULT_BANDWIDTH_PERCENT,
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

/// Contribution statistics for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionStats {
    /// Total bytes contributed all time
    pub total_bytes_contributed: u64,
    
    /// Total VPN bytes used all time
    pub total_vpn_bytes_used: u64,
    
    /// Current contribution ratio (contributed / used)
    pub contribution_ratio: f64,
    
    /// Tokens earned (if earning mode)
    pub tokens_earned: f64,
    
    /// Pending tokens
    pub tokens_pending: f64,
    
    /// Unique users helped (sessions served)
    pub users_helped: u64,
    
    /// CDN requests served
    pub cdn_requests_served: u64,
    
    /// Uptime as contributor (seconds)
    pub uptime_seconds: u64,
}

/// Manages contribution state and operations
pub struct ContributionManager {
    status: ContributionStatus,
    settings: ContributionSettings,
    stats: ContributionStats,
    
    /// Country code of this node (for legal compliance)
    country_code: String,
}

impl ContributionManager {
    pub fn new() -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Period is monthly
        let period_end = now + 30 * 24 * 60 * 60;
        
        Self {
            status: ContributionStatus {
                vpn_bytes_used: 0,
                bytes_contributed: 0,
                contribution_cap: 0,
                quota_remaining: 0,
                is_contributing: false,
                is_paused: false,
                cdn_bytes_served: 0,
                relay_bytes_served: 0,
                period_start: now,
                period_end,
            },
            settings: ContributionSettings::default(),
            stats: ContributionStats {
                total_bytes_contributed: 0,
                total_vpn_bytes_used: 0,
                contribution_ratio: 0.0,
                tokens_earned: 0.0,
                tokens_pending: 0.0,
                users_helped: 0,
                cdn_requests_served: 0,
                uptime_seconds: 0,
            },
            country_code: "US".to_string(),
        }
    }
    
    /// Set country code (for legal compliance)
    pub fn set_country(&mut self, country_code: String) {
        // Disable VPN relay in countries where it's not legal
        let blocked_countries = ["CN", "RU", "IR", "BY", "KP", "AE", "OM", "TM"];
        if blocked_countries.contains(&country_code.as_str()) {
            self.settings.share_vpn_relay = false;
        }
        
        self.country_code = country_code;
    }
    
    /// Get current contribution status
    pub fn get_status(&self) -> ContributionStatus {
        self.status.clone()
    }
    
    /// Get contribution settings
    pub fn get_settings(&self) -> ContributionSettings {
        self.settings.clone()
    }
    
    /// Update contribution settings
    pub fn update_settings(&mut self, settings: ContributionSettings) {
        // Enforce legal restrictions
        let mut settings = settings;
        let blocked_countries = ["CN", "RU", "IR", "BY", "KP", "AE", "OM", "TM"];
        if blocked_countries.contains(&self.country_code.as_str()) {
            settings.share_vpn_relay = false;
        }
        
        self.settings = settings;
    }
    
    /// Get contribution statistics
    pub fn get_stats(&self) -> ContributionStats {
        self.stats.clone()
    }
    
    /// Record VPN usage
    pub fn record_vpn_usage(&mut self, bytes: u64) {
        self.status.vpn_bytes_used += bytes;
        self.status.contribution_cap = self.status.vpn_bytes_used * CONTRIBUTION_MULTIPLIER;
        self.status.quota_remaining = self.status.contribution_cap
            .saturating_sub(self.status.bytes_contributed);
        
        self.stats.total_vpn_bytes_used += bytes;
        self.update_ratio();
    }
    
    /// Record contribution (CDN or relay)
    pub fn record_contribution(&mut self, bytes: u64, is_cdn: bool) {
        // Check if we've reached cap
        if self.status.bytes_contributed >= self.status.contribution_cap {
            return;
        }
        
        // Don't exceed cap
        let actual = std::cmp::min(bytes, self.status.quota_remaining);
        
        self.status.bytes_contributed += actual;
        self.status.quota_remaining = self.status.contribution_cap
            .saturating_sub(self.status.bytes_contributed);
        
        if is_cdn {
            self.status.cdn_bytes_served += actual;
            self.stats.cdn_requests_served += 1;
        } else {
            self.status.relay_bytes_served += actual;
        }
        
        self.stats.total_bytes_contributed += actual;
        self.stats.users_helped += 1;
        self.update_ratio();
    }
    
    /// Check if contribution is allowed (under cap, not paused, etc.)
    pub fn can_contribute(&self) -> bool {
        if !self.settings.enabled {
            return false;
        }
        if self.status.is_paused {
            return false;
        }
        if self.status.bytes_contributed >= self.status.contribution_cap {
            return false;
        }
        if self.settings.schedule_enabled && !self.is_within_schedule() {
            return false;
        }
        true
    }
    
    /// Check if VPN relay is allowed (legal in this country)
    pub fn can_relay_vpn(&self) -> bool {
        self.can_contribute() && self.settings.share_vpn_relay
    }
    
    /// Check if CDN serving is allowed
    pub fn can_serve_cdn(&self) -> bool {
        self.can_contribute() && self.settings.share_cdn
    }
    
    /// Get current bandwidth allowance (Mbps)
    pub fn get_bandwidth_allowance(&self) -> u32 {
        if !self.can_contribute() {
            return 0;
        }
        
        let percent = if self.settings.earning_mode {
            self.settings.earning_bandwidth_percent
        } else {
            self.settings.max_bandwidth_percent
        };
        
        // TODO: Get actual bandwidth and calculate allowance
        // For now, return based on 100 Mbps base
        (100 * percent as u32) / 100
    }
    
    /// Pause contribution
    pub fn pause(&mut self) {
        self.status.is_paused = true;
        self.status.is_contributing = false;
    }
    
    /// Resume contribution
    pub fn resume(&mut self) {
        self.status.is_paused = false;
    }
    
    /// Start contributing
    pub fn start_contributing(&mut self) {
        if self.can_contribute() {
            self.status.is_contributing = true;
        }
    }
    
    /// Stop contributing
    pub fn stop_contributing(&mut self) {
        self.status.is_contributing = false;
    }
    
    /// Reset period (called when period ends)
    pub fn reset_period(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        self.status.vpn_bytes_used = 0;
        self.status.bytes_contributed = 0;
        self.status.contribution_cap = 0;
        self.status.quota_remaining = 0;
        self.status.cdn_bytes_served = 0;
        self.status.relay_bytes_served = 0;
        self.status.period_start = now;
        self.status.period_end = now + 30 * 24 * 60 * 60;
    }
    
    /// Check if current time is within scheduled contribution window
    fn is_within_schedule(&self) -> bool {
        // TODO: Implement schedule checking
        // For now, return true
        true
    }
    
    /// Update contribution ratio stat
    fn update_ratio(&mut self) {
        if self.stats.total_vpn_bytes_used > 0 {
            self.stats.contribution_ratio = 
                self.stats.total_bytes_contributed as f64 / 
                self.stats.total_vpn_bytes_used as f64;
        }
    }
}

impl Default for ContributionManager {
    fn default() -> Self {
        Self::new()
    }
}

