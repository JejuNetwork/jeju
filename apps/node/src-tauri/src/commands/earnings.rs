//! Earnings tracking commands

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsSummary {
    pub total_earnings_wei: String,
    pub total_earnings_usd: f64,
    pub earnings_today_wei: String,
    pub earnings_today_usd: f64,
    pub earnings_this_week_wei: String,
    pub earnings_this_week_usd: f64,
    pub earnings_this_month_wei: String,
    pub earnings_this_month_usd: f64,
    pub earnings_by_service: Vec<ServiceEarnings>,
    pub earnings_by_bot: Vec<BotEarnings>,
    pub avg_hourly_rate_usd: f64,
    pub projected_monthly_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceEarnings {
    pub service_id: String,
    pub service_name: String,
    pub total_wei: String,
    pub total_usd: f64,
    pub today_wei: String,
    pub today_usd: f64,
    pub requests_served: u64,
    pub uptime_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotEarnings {
    pub bot_id: String,
    pub bot_name: String,
    pub gross_profit_wei: String,
    pub treasury_share_wei: String,
    pub net_profit_wei: String,
    pub net_profit_usd: f64,
    pub opportunities_executed: u64,
    pub success_rate_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsHistoryEntry {
    pub timestamp: i64,
    pub date: String,
    pub service_id: String,
    pub amount_wei: String,
    pub amount_usd: f64,
    pub tx_hash: Option<String>,
    pub event_type: String, // "reward", "claim", "bot_profit"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectedEarnings {
    pub hourly_usd: f64,
    pub daily_usd: f64,
    pub weekly_usd: f64,
    pub monthly_usd: f64,
    pub yearly_usd: f64,
    pub breakdown: Vec<ServiceProjection>,
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceProjection {
    pub service_id: String,
    pub service_name: String,
    pub enabled: bool,
    pub hourly_usd: f64,
    pub monthly_usd: f64,
    pub factors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EarningsHistoryRequest {
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
    pub service_id: Option<String>,
    pub limit: Option<u32>,
}

#[tauri::command]
pub async fn get_earnings_summary(
    state: State<'_, AppState>,
) -> Result<EarningsSummary, String> {
    let inner = state.inner.read();
    
    // TODO: Aggregate earnings from:
    // 1. On-chain claims history
    // 2. Pending rewards from staking contracts
    // 3. Bot profits from trading history
    // 4. Local earnings tracker cache
    
    Ok(EarningsSummary {
        total_earnings_wei: "0".to_string(),
        total_earnings_usd: 0.0,
        earnings_today_wei: "0".to_string(),
        earnings_today_usd: 0.0,
        earnings_this_week_wei: "0".to_string(),
        earnings_this_week_usd: 0.0,
        earnings_this_month_wei: "0".to_string(),
        earnings_this_month_usd: 0.0,
        earnings_by_service: vec![],
        earnings_by_bot: vec![],
        avg_hourly_rate_usd: 0.0,
        projected_monthly_usd: 0.0,
    })
}

#[tauri::command]
pub async fn get_earnings_history(
    state: State<'_, AppState>,
    request: EarningsHistoryRequest,
) -> Result<Vec<EarningsHistoryEntry>, String> {
    let inner = state.inner.read();
    
    // TODO: Query earnings history from:
    // 1. Local database
    // 2. On-chain events if needed
    
    Ok(vec![])
}

#[tauri::command]
pub async fn get_projected_earnings(
    state: State<'_, AppState>,
) -> Result<ProjectedEarnings, String> {
    let inner = state.inner.read();
    
    // Calculate projections based on:
    // 1. Current hardware capabilities
    // 2. Network demand
    // 3. Staking amounts
    // 4. Historical performance
    
    let mut projections = vec![];
    let mut total_hourly = 0.0;
    
    // Service projections
    for (service_id, config) in &inner.config.services {
        let hourly_rate = match service_id.as_str() {
            "compute" if config.enabled => 0.50,
            "storage" if config.enabled => 0.10,
            "oracle" if config.enabled => 0.20,
            "proxy" if config.enabled => 0.15,
            "cron" if config.enabled => 0.05,
            "rpc" if config.enabled => 0.25,
            "xlp" if config.enabled => 0.40,
            "solver" if config.enabled => 0.30,
            "sequencer" if config.enabled => 0.50,
            _ => 0.0,
        };
        
        total_hourly += hourly_rate;
        
        projections.push(ServiceProjection {
            service_id: service_id.clone(),
            service_name: service_id.clone(),
            enabled: config.enabled,
            hourly_usd: hourly_rate,
            monthly_usd: hourly_rate * 24.0 * 30.0,
            factors: vec![
                "Based on network average".to_string(),
                "Assumes 100% uptime".to_string(),
            ],
        });
    }
    
    // Bot projections
    for (bot_id, config) in &inner.config.bots {
        if config.enabled {
            let hourly_rate = match bot_id.as_str() {
                "dex_arb" => 0.20,
                "cross_chain_arb" => 0.30,
                "sandwich" => 0.15,
                "liquidation" => 0.25,
                "oracle_keeper" => 0.10,
                "solver" => 0.20,
                _ => 0.0,
            };
            
            total_hourly += hourly_rate;
            
            projections.push(ServiceProjection {
                service_id: format!("bot_{}", bot_id),
                service_name: format!("{} Bot", bot_id),
                enabled: config.enabled,
                hourly_usd: hourly_rate,
                monthly_usd: hourly_rate * 24.0 * 30.0,
                factors: vec![
                    "Highly variable based on market conditions".to_string(),
                    "50% goes to network treasury".to_string(),
                ],
            });
        }
    }
    
    Ok(ProjectedEarnings {
        hourly_usd: total_hourly,
        daily_usd: total_hourly * 24.0,
        weekly_usd: total_hourly * 24.0 * 7.0,
        monthly_usd: total_hourly * 24.0 * 30.0,
        yearly_usd: total_hourly * 24.0 * 365.0,
        breakdown: projections,
        assumptions: vec![
            "Network demand remains constant".to_string(),
            "100% uptime assumed".to_string(),
            "Current token prices used".to_string(),
            "Bot profits are highly variable".to_string(),
        ],
    })
}

#[tauri::command]
pub async fn export_earnings(
    state: State<'_, AppState>,
    format: String, // "csv" or "json"
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<String, String> {
    let inner = state.inner.read();
    
    // TODO: Export earnings data to file
    // 1. Query all earnings history
    // 2. Format as CSV or JSON
    // 3. Write to file in data directory
    // 4. Return file path
    
    Err("Export not yet implemented".to_string())
}

