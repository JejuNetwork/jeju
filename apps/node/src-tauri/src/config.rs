//! Node configuration management

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Service-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub enabled: bool,
    pub auto_start: bool,
    pub stake_amount: Option<String>,
    pub custom_settings: HashMap<String, serde_json::Value>,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_start: false,
            stake_amount: None,
            custom_settings: HashMap::new(),
        }
    }
}

/// Bot-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub enabled: bool,
    pub auto_start: bool,
    pub min_profit_bps: u32,
    pub max_gas_gwei: u32,
    pub max_slippage_bps: u32,
    pub capital_allocation_wei: String,
}

impl Default for BotConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_start: false,
            min_profit_bps: 10,
            max_gas_gwei: 100,
            max_slippage_bps: 50,
            capital_allocation_wei: "0".to_string(),
        }
    }
}

/// Network configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub network: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub ws_url: Option<String>,
    pub explorer_url: String,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            network: "mainnet".to_string(),
            chain_id: 420690,
            rpc_url: "https://rpc.jejunetwork.org".to_string(),
            ws_url: Some("wss://ws.jejunetwork.org".to_string()),
            explorer_url: "https://explorer.jejunetwork.org".to_string(),
        }
    }
}

/// Wallet configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub wallet_type: WalletType,
    pub address: Option<String>,
    pub encrypted_key: Option<String>,
    pub agent_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WalletType {
    None,
    Embedded,
    External,
    JejuWallet,
}

impl Default for WalletConfig {
    fn default() -> Self {
        Self {
            wallet_type: WalletType::None,
            address: None,
            encrypted_key: None,
            agent_id: None,
        }
    }
}

/// Earnings configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsConfig {
    pub auto_claim: bool,
    pub auto_claim_threshold_wei: String,
    pub auto_claim_interval_hours: u32,
    pub auto_compound: bool,
    pub auto_stake_earnings: bool,
}

impl Default for EarningsConfig {
    fn default() -> Self {
        Self {
            auto_claim: true,
            auto_claim_threshold_wei: "1000000000000000000".to_string(), // 1 ETH
            auto_claim_interval_hours: 24,
            auto_compound: false,
            auto_stake_earnings: false,
        }
    }
}

/// Main node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    pub version: String,
    pub network: NetworkConfig,
    pub wallet: WalletConfig,
    pub earnings: EarningsConfig,
    pub services: HashMap<String, ServiceConfig>,
    pub bots: HashMap<String, BotConfig>,
    pub start_minimized: bool,
    pub start_on_boot: bool,
    pub notifications_enabled: bool,
}

impl Default for NodeConfig {
    fn default() -> Self {
        let mut services = HashMap::new();

        // Initialize all services with defaults
        for service_id in &[
            "compute",
            "storage",
            "oracle",
            "proxy",
            "cron",
            "rpc",
            "xlp",
            "solver",
            "sequencer",
        ] {
            services.insert(service_id.to_string(), ServiceConfig::default());
        }

        let mut bots = HashMap::new();
        for bot_id in &[
            "dex_arb",
            "cross_chain_arb",
            "sandwich",
            "liquidation",
            "oracle_keeper",
            "solver",
        ] {
            bots.insert(bot_id.to_string(), BotConfig::default());
        }

        Self {
            version: "1.0.0".to_string(),
            network: NetworkConfig::default(),
            wallet: WalletConfig::default(),
            earnings: EarningsConfig::default(),
            services,
            bots,
            start_minimized: false,
            start_on_boot: false,
            notifications_enabled: true,
        }
    }
}

impl NodeConfig {
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let config_path = Self::config_path()?;

        if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)?;
            let config: NodeConfig = serde_json::from_str(&contents)?;
            Ok(config)
        } else {
            let config = Self::default();
            config.save()?;
            Ok(config)
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let config_path = Self::config_path()?;

        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let contents = serde_json::to_string_pretty(self)?;
        std::fs::write(&config_path, contents)?;

        Ok(())
    }

    pub fn config_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir().ok_or("Could not find config directory")?;
        Ok(config_dir.join("jeju-node").join("config.json"))
    }

    pub fn data_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let data_dir = dirs::data_dir().ok_or("Could not find data directory")?;
        Ok(data_dir.join("jeju-node"))
    }
}
