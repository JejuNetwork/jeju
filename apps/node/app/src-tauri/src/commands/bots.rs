//! Trading bot management commands

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotType {
    DexArb,
    CrossChainArb,
    Sandwich,
    Liquidation,
    OracleKeeper,
    Solver,
}

impl BotType {
    pub fn all() -> Vec<BotType> {
        vec![
            BotType::DexArb,
            BotType::CrossChainArb,
            BotType::Sandwich,
            BotType::Liquidation,
            BotType::OracleKeeper,
            BotType::Solver,
        ]
    }

    pub fn id(&self) -> &'static str {
        match self {
            BotType::DexArb => "dex_arb",
            BotType::CrossChainArb => "cross_chain_arb",
            BotType::Sandwich => "sandwich",
            BotType::Liquidation => "liquidation",
            BotType::OracleKeeper => "oracle_keeper",
            BotType::Solver => "solver",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub min_capital_eth: f64,
    pub treasury_split_percent: u32,
    pub risk_level: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotStatus {
    pub id: String,
    pub running: bool,
    pub uptime_seconds: u64,
    pub opportunities_detected: u64,
    pub opportunities_executed: u64,
    pub opportunities_failed: u64,
    pub gross_profit_wei: String,
    pub treasury_share_wei: String,
    pub net_profit_wei: String,
    pub last_opportunity: Option<OpportunityInfo>,
    pub health: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpportunityInfo {
    pub timestamp: i64,
    pub opportunity_type: String,
    pub estimated_profit_wei: String,
    pub actual_profit_wei: Option<String>,
    pub tx_hash: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotWithStatus {
    pub metadata: BotMetadata,
    pub status: BotStatus,
    pub config: crate::config::BotConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartBotRequest {
    pub bot_id: String,
    pub capital_allocation_wei: String,
    pub min_profit_bps: Option<u32>,
    pub max_gas_gwei: Option<u32>,
    pub max_slippage_bps: Option<u32>,
}

#[tauri::command]
pub async fn get_available_bots(state: State<'_, AppState>) -> Result<Vec<BotWithStatus>, String> {
    let inner = state.inner.read().await;

    let bots: Vec<BotWithStatus> = BotType::all()
        .into_iter()
        .map(|bot_type| {
            let id = bot_type.id();

            let metadata = match bot_type {
                BotType::DexArb => BotMetadata {
                    id: id.to_string(),
                    name: "DEX Arbitrage Bot".to_string(),
                    description: "Detects and executes arbitrage opportunities across DEX pools on Jeju and other chains.".to_string(),
                    min_capital_eth: 0.1,
                    treasury_split_percent: 50,
                    risk_level: "Medium".to_string(),
                    warnings: vec![
                        "Profits are variable and depend on market conditions".to_string(),
                        "50% of profits go to network treasury".to_string(),
                    ],
                },
                BotType::CrossChainArb => BotMetadata {
                    id: id.to_string(),
                    name: "Cross-Chain Arbitrage Bot".to_string(),
                    description: "Arbitrages price differences between Jeju and other chains via bridges.".to_string(),
                    min_capital_eth: 0.5,
                    treasury_split_percent: 50,
                    risk_level: "High".to_string(),
                    warnings: vec![
                        "Cross-chain transactions have higher latency and risk".to_string(),
                        "Bridge fees affect profitability".to_string(),
                        "50% of profits go to network treasury".to_string(),
                    ],
                },
                BotType::Sandwich => BotMetadata {
                    id: id.to_string(),
                    name: "Sandwich Bot".to_string(),
                    description: "Executes sandwich trades on pending transactions. Controversial but helps prevent external MEV extraction.".to_string(),
                    min_capital_eth: 0.2,
                    treasury_split_percent: 50,
                    risk_level: "High".to_string(),
                    warnings: vec![
                        "⚠️ This is a controversial MEV strategy".to_string(),
                        "Network policy: keeping MEV in-network benefits all participants".to_string(),
                        "Prevents external actors from extracting value".to_string(),
                        "50% of profits go to network treasury".to_string(),
                    ],
                },
                BotType::Liquidation => BotMetadata {
                    id: id.to_string(),
                    name: "Liquidation Bot".to_string(),
                    description: "Liquidates undercollateralized positions in lending protocols and perps.".to_string(),
                    min_capital_eth: 0.3,
                    treasury_split_percent: 50,
                    risk_level: "Medium".to_string(),
                    warnings: vec![
                        "Requires capital for liquidations".to_string(),
                        "Competition from other liquidators".to_string(),
                        "50% of profits go to network treasury".to_string(),
                    ],
                },
                BotType::OracleKeeper => BotMetadata {
                    id: id.to_string(),
                    name: "Oracle Keeper Bot".to_string(),
                    description: "Keeps price oracles updated and earns keeper fees.".to_string(),
                    min_capital_eth: 0.1,
                    treasury_split_percent: 50,
                    risk_level: "Low".to_string(),
                    warnings: vec![
                        "Lower profits but more consistent".to_string(),
                        "Gas costs may exceed rewards in low-activity periods".to_string(),
                    ],
                },
                BotType::Solver => BotMetadata {
                    id: id.to_string(),
                    name: "OIF Solver Bot".to_string(),
                    description: "Fills intents from the OIF (Open Intent Framework) for cross-chain swaps.".to_string(),
                    min_capital_eth: 0.2,
                    treasury_split_percent: 50,
                    risk_level: "Medium".to_string(),
                    warnings: vec![
                        "Competes on speed and price with other solvers".to_string(),
                        "50% of profits go to network treasury".to_string(),
                    ],
                },
            };

            let config = inner.config.bots
                .get(id)
                .cloned()
                .unwrap_or_default();

            BotWithStatus {
                metadata,
                status: BotStatus {
                    id: id.to_string(),
                    running: false,
                    uptime_seconds: 0,
                    opportunities_detected: 0,
                    opportunities_executed: 0,
                    opportunities_failed: 0,
                    gross_profit_wei: "0".to_string(),
                    treasury_share_wei: "0".to_string(),
                    net_profit_wei: "0".to_string(),
                    last_opportunity: None,
                    health: "stopped".to_string(),
                },
                config,
            }
        })
        .collect();

    Ok(bots)
}

#[tauri::command]
pub async fn start_bot(
    state: State<'_, AppState>,
    request: StartBotRequest,
) -> Result<BotStatus, String> {
    let mut inner = state.inner.write().await;

    // Verify wallet
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // Update bot config
    let config = inner
        .config
        .bots
        .entry(request.bot_id.clone())
        .or_insert_with(crate::config::BotConfig::default);

    config.enabled = true;
    config.auto_start = true;
    config.capital_allocation_wei = request.capital_allocation_wei;

    if let Some(min_profit) = request.min_profit_bps {
        config.min_profit_bps = min_profit;
    }
    if let Some(max_gas) = request.max_gas_gwei {
        config.max_gas_gwei = max_gas;
    }
    if let Some(max_slippage) = request.max_slippage_bps {
        config.max_slippage_bps = max_slippage;
    }

    inner.config.save().map_err(|e| e.to_string())?;

    let bot_id = request.bot_id.clone();
    inner.bot_status.insert(
        bot_id.clone(),
        crate::state::BotStatus {
            id: bot_id.clone(),
            name: bot_id.clone(),
            running: true,
            strategy: bot_id.clone(),
            opportunities_found: 0,
            opportunities_executed: 0,
            total_profit_wei: "0".to_string(),
            treasury_share_wei: "0".to_string(),
        },
    );

    Ok(BotStatus {
        id: bot_id,
        running: true,
        uptime_seconds: 0,
        opportunities_detected: 0,
        opportunities_executed: 0,
        opportunities_failed: 0,
        gross_profit_wei: "0".to_string(),
        treasury_share_wei: "0".to_string(),
        net_profit_wei: "0".to_string(),
        last_opportunity: None,
        health: "starting".to_string(),
    })
}

#[tauri::command]
pub async fn stop_bot(state: State<'_, AppState>, bot_id: String) -> Result<BotStatus, String> {
    let mut inner = state.inner.write().await;

    if let Some(config) = inner.config.bots.get_mut(&bot_id) {
        config.enabled = false;
    }
    inner.config.save().map_err(|e| e.to_string())?;

    if let Some(status) = inner.bot_status.get_mut(&bot_id) {
        status.running = false;
    }

    let status = inner
        .bot_status
        .get(&bot_id)
        .cloned()
        .map(BotStatus::from)
        .unwrap_or(BotStatus {
            id: bot_id,
            running: false,
            uptime_seconds: 0,
            opportunities_detected: 0,
            opportunities_executed: 0,
            opportunities_failed: 0,
            gross_profit_wei: "0".to_string(),
            treasury_share_wei: "0".to_string(),
            net_profit_wei: "0".to_string(),
            last_opportunity: None,
            health: "stopped".to_string(),
        });

    Ok(status)
}

#[tauri::command]
pub async fn get_bot_status(
    state: State<'_, AppState>,
    bot_id: String,
) -> Result<BotStatus, String> {
    let inner = state.inner.read().await;

    let bot_status = inner.bot_status.get(&bot_id);

    if let Some(status) = bot_status {
        Ok(status.clone().into())
    } else {
        Ok(BotStatus {
            id: bot_id,
            running: false,
            uptime_seconds: 0,
            opportunities_detected: 0,
            opportunities_executed: 0,
            opportunities_failed: 0,
            gross_profit_wei: "0".to_string(),
            treasury_share_wei: "0".to_string(),
            net_profit_wei: "0".to_string(),
            last_opportunity: None,
            health: "stopped".to_string(),
        })
    }
}

#[tauri::command]
pub async fn get_bot_earnings(
    state: State<'_, AppState>,
    bot_id: String,
    days: Option<u32>,
) -> Result<Vec<OpportunityInfo>, String> {
    let inner = state.inner.read().await;

    let start_time = days.map(|d| chrono::Utc::now().timestamp() - (d as i64 * 24 * 60 * 60));

    let entries = inner.earnings_tracker.get_entries(
        Some(&format!("bot_{}", bot_id)),
        start_time,
        None,
        Some(100),
    );

    let opportunities: Vec<OpportunityInfo> = entries
        .into_iter()
        .map(|e| OpportunityInfo {
            timestamp: e.timestamp,
            opportunity_type: format!("{:?}", e.event_type),
            estimated_profit_wei: e.amount_wei.clone(),
            actual_profit_wei: Some(e.amount_wei.clone()),
            tx_hash: e.tx_hash.clone(),
            status: "executed".to_string(),
        })
        .collect();

    Ok(opportunities)
}

impl From<crate::state::BotStatus> for BotStatus {
    fn from(status: crate::state::BotStatus) -> Self {
        let gross: u128 = status.total_profit_wei.parse().unwrap_or(0);
        let treasury: u128 = status.treasury_share_wei.parse().unwrap_or(0);
        let net = gross.saturating_sub(treasury);

        BotStatus {
            id: status.id,
            running: status.running,
            uptime_seconds: 0,
            opportunities_detected: status.opportunities_found,
            opportunities_executed: status.opportunities_executed,
            opportunities_failed: 0,
            gross_profit_wei: status.total_profit_wei,
            treasury_share_wei: status.treasury_share_wei,
            net_profit_wei: net.to_string(),
            last_opportunity: None,
            health: if status.running {
                "healthy".to_string()
            } else {
                "stopped".to_string()
            },
        }
    }
}
