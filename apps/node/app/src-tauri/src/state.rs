//! Application state management

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

use crate::config::NodeConfig;
use crate::earnings::EarningsTracker;
use crate::services::ServiceManager;
use crate::wallet::WalletManager;

/// Service status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub id: String,
    pub name: String,
    pub running: bool,
    pub uptime_seconds: u64,
    pub requests_served: u64,
    pub earnings_wei: String,
    pub health: ServiceHealth,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceHealth {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

/// Bot status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotStatus {
    pub id: String,
    pub name: String,
    pub running: bool,
    pub strategy: String,
    pub opportunities_found: u64,
    pub opportunities_executed: u64,
    pub total_profit_wei: String,
    pub treasury_share_wei: String,
}

/// Network information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    pub network: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub connected: bool,
    pub block_number: u64,
    pub gas_price_gwei: f64,
}

/// Inner state protected by RwLock
pub struct AppStateInner {
    pub config: NodeConfig,
    pub wallet_manager: Option<WalletManager>,
    pub service_manager: ServiceManager,
    pub earnings_tracker: EarningsTracker,
    pub service_status: HashMap<String, ServiceStatus>,
    pub bot_status: HashMap<String, BotStatus>,
    pub network_info: NetworkInfo,
    pub initialized: bool,
}

/// Thread-safe application state
pub struct AppState {
    pub inner: Arc<RwLock<AppStateInner>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AppStateInner {
                config: NodeConfig::default(),
                wallet_manager: None,
                service_manager: ServiceManager::new(),
                earnings_tracker: EarningsTracker::new(),
                service_status: HashMap::new(),
                bot_status: HashMap::new(),
                network_info: NetworkInfo {
                    network: "mainnet".to_string(),
                    chain_id: 420690,
                    rpc_url: "https://rpc.jejunetwork.org".to_string(),
                    connected: false,
                    block_number: 0,
                    gas_price_gwei: 0.0,
                },
                initialized: false,
            })),
        }
    }

    pub fn initialize(&self, _handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let mut state = self.inner.blocking_write();

        // Load config from disk
        state.config = NodeConfig::load()?;

        // Initialize services based on config - clone to avoid borrow conflict
        let config_clone = state.config.clone();
        state.service_manager.initialize(&config_clone)?;

        // Load earnings history
        state.earnings_tracker.load()?;

        state.initialized = true;

        tracing::info!("Application state initialized");
        Ok(())
    }

    pub fn is_initialized(&self) -> bool {
        self.inner.blocking_read().initialized
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
