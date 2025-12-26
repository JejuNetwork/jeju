//! Configuration management commands

use crate::config::{BotConfig, EarningsConfig, NetworkConfig, ServiceConfig};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: String,
    pub network: NetworkConfig,
    pub wallet: WalletConfigPublic,
    pub earnings: EarningsConfig,
    pub services: HashMap<String, ServiceConfig>,
    pub bots: HashMap<String, BotConfig>,
    pub start_minimized: bool,
    pub start_on_boot: bool,
    pub notifications_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfigPublic {
    pub wallet_type: String,
    pub address: Option<String>,
    pub agent_id: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateConfigRequest {
    pub earnings: Option<EarningsConfig>,
    pub services: Option<HashMap<String, ServiceConfig>>,
    pub bots: Option<HashMap<String, BotConfig>>,
    pub start_minimized: Option<bool>,
    pub start_on_boot: Option<bool>,
    pub notifications_enabled: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkOption {
    pub id: String,
    pub name: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub explorer_url: String,
    pub is_testnet: bool,
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let inner = state.inner.read().await;

    let wallet_type = match inner.config.wallet.wallet_type {
        crate::config::WalletType::None => "none",
        crate::config::WalletType::Embedded => "embedded",
        crate::config::WalletType::External => "external",
        crate::config::WalletType::JejuWallet => "jeju_wallet",
    };

    Ok(AppConfig {
        version: inner.config.version.clone(),
        network: inner.config.network.clone(),
        wallet: WalletConfigPublic {
            wallet_type: wallet_type.to_string(),
            address: inner.config.wallet.address.clone(),
            agent_id: inner.config.wallet.agent_id,
        },
        earnings: inner.config.earnings.clone(),
        services: inner.config.services.clone(),
        bots: inner.config.bots.clone(),
        start_minimized: inner.config.start_minimized,
        start_on_boot: inner.config.start_on_boot,
        notifications_enabled: inner.config.notifications_enabled,
    })
}

#[tauri::command]
pub async fn update_config(
    state: State<'_, AppState>,
    request: UpdateConfigRequest,
) -> Result<AppConfig, String> {
    let mut inner = state.inner.write().await;

    if let Some(earnings) = request.earnings {
        inner.config.earnings = earnings;
    }

    if let Some(services) = request.services {
        for (id, config) in services {
            inner.config.services.insert(id, config);
        }
    }

    if let Some(bots) = request.bots {
        for (id, config) in bots {
            inner.config.bots.insert(id, config);
        }
    }

    if let Some(start_minimized) = request.start_minimized {
        inner.config.start_minimized = start_minimized;
    }

    if let Some(start_on_boot) = request.start_on_boot {
        inner.config.start_on_boot = start_on_boot;
    }

    if let Some(notifications) = request.notifications_enabled {
        inner.config.notifications_enabled = notifications;
    }

    inner.config.save().map_err(|e| e.to_string())?;

    // Return updated config
    let wallet_type = match inner.config.wallet.wallet_type {
        crate::config::WalletType::None => "none",
        crate::config::WalletType::Embedded => "embedded",
        crate::config::WalletType::External => "external",
        crate::config::WalletType::JejuWallet => "jeju_wallet",
    };

    Ok(AppConfig {
        version: inner.config.version.clone(),
        network: inner.config.network.clone(),
        wallet: WalletConfigPublic {
            wallet_type: wallet_type.to_string(),
            address: inner.config.wallet.address.clone(),
            agent_id: inner.config.wallet.agent_id,
        },
        earnings: inner.config.earnings.clone(),
        services: inner.config.services.clone(),
        bots: inner.config.bots.clone(),
        start_minimized: inner.config.start_minimized,
        start_on_boot: inner.config.start_on_boot,
        notifications_enabled: inner.config.notifications_enabled,
    })
}

#[tauri::command]
pub async fn get_network_config(state: State<'_, AppState>) -> Result<NetworkConfig, String> {
    let inner = state.inner.read().await;
    Ok(inner.config.network.clone())
}

#[tauri::command]
pub async fn set_network(
    state: State<'_, AppState>,
    network: String,
) -> Result<NetworkConfig, String> {
    let mut inner = state.inner.write().await;

    let network_config = match network.as_str() {
        "mainnet" => NetworkConfig {
            network: "mainnet".to_string(),
            chain_id: 420690,
            rpc_url: "https://rpc.jejunetwork.org".to_string(),
            ws_url: Some("wss://ws.jejunetwork.org".to_string()),
            explorer_url: "https://explorer.jejunetwork.org".to_string(),
        },
        "testnet" => NetworkConfig {
            network: "testnet".to_string(),
            chain_id: 420691,
            rpc_url: "https://testnet-rpc.jejunetwork.org".to_string(),
            ws_url: Some("wss://testnet-ws.jejunetwork.org".to_string()),
            explorer_url: "https://testnet-explorer.jejunetwork.org".to_string(),
        },
        "localnet" => NetworkConfig {
            network: "localnet".to_string(),
            chain_id: 31337,
            rpc_url: "http://localhost:6546".to_string(),
            ws_url: Some("ws://localhost:6547".to_string()),
            explorer_url: "http://localhost:4000".to_string(),
        },
        _ => return Err(format!("Unknown network: {}", network)),
    };

    inner.config.network = network_config.clone();
    inner.config.save().map_err(|e| e.to_string())?;

    // Re-initialize services with new network - clone config to avoid borrow conflict
    let config_clone = inner.config.clone();
    inner
        .service_manager
        .initialize(&config_clone)
        .map_err(|e| e.to_string())?;

    Ok(network_config)
}
