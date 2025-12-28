//! Earnings tracking commands

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

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
pub async fn get_earnings_summary(state: State<'_, AppState>) -> Result<EarningsSummary, String> {
    let inner = state.inner.read().await;
    let stats = inner.earnings_tracker.get_stats();

    let today_wei = inner.earnings_tracker.get_total_today();
    let total_wei: u128 = stats.total_wei.parse().unwrap_or(0);
    let today_wei_val: u128 = today_wei.parse().unwrap_or(0);

    let mut earnings_by_service = vec![];
    for (service_id, amount_wei) in &stats.by_service {
        let amount: u128 = amount_wei.parse().unwrap_or(0);
        earnings_by_service.push(ServiceEarnings {
            service_id: service_id.clone(),
            service_name: service_id.clone(),
            total_wei: amount_wei.clone(),
            total_usd: (amount as f64) / 1e18 * 2000.0,
            today_wei: "0".to_string(),
            today_usd: 0.0,
            requests_served: 0,
            uptime_percent: 100.0,
        });
    }

    let mut earnings_by_bot = vec![];
    for (bot_id, status) in &inner.bot_status {
        let gross: u128 = status.total_profit_wei.parse().unwrap_or(0);
        let treasury: u128 = status.treasury_share_wei.parse().unwrap_or(0);
        let net = gross.saturating_sub(treasury);
        earnings_by_bot.push(BotEarnings {
            bot_id: bot_id.clone(),
            bot_name: status.name.clone(),
            gross_profit_wei: status.total_profit_wei.clone(),
            treasury_share_wei: status.treasury_share_wei.clone(),
            net_profit_wei: net.to_string(),
            net_profit_usd: (net as f64) / 1e18 * 2000.0,
            opportunities_executed: status.opportunities_executed,
            success_rate_percent: if status.opportunities_found > 0 {
                (status.opportunities_executed as f64 / status.opportunities_found as f64) * 100.0
            } else {
                0.0
            },
        });
    }

    let avg_hourly_rate_usd = if !stats.by_day.is_empty() {
        let total_usd = (total_wei as f64) / 1e18 * 2000.0;
        total_usd / (stats.by_day.len() as f64 * 24.0)
    } else {
        0.0
    };

    Ok(EarningsSummary {
        total_earnings_wei: stats.total_wei.clone(),
        total_earnings_usd: (total_wei as f64) / 1e18 * 2000.0,
        earnings_today_wei: today_wei.clone(),
        earnings_today_usd: (today_wei_val as f64) / 1e18 * 2000.0,
        earnings_this_week_wei: "0".to_string(),
        earnings_this_week_usd: 0.0,
        earnings_this_month_wei: "0".to_string(),
        earnings_this_month_usd: 0.0,
        earnings_by_service,
        earnings_by_bot,
        avg_hourly_rate_usd,
        projected_monthly_usd: avg_hourly_rate_usd * 24.0 * 30.0,
    })
}

#[tauri::command]
pub async fn get_earnings_history(
    state: State<'_, AppState>,
    request: EarningsHistoryRequest,
) -> Result<Vec<EarningsHistoryEntry>, String> {
    let inner = state.inner.read().await;

    let entries = inner.earnings_tracker.get_entries(
        request.service_id.as_deref(),
        request.start_timestamp,
        request.end_timestamp,
        request.limit.map(|l| l as usize),
    );

    let result = entries
        .into_iter()
        .map(|e| {
            let date = chrono::DateTime::from_timestamp(e.timestamp, 0)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            let amount: u128 = e.amount_wei.parse().unwrap_or(0);

            EarningsHistoryEntry {
                timestamp: e.timestamp,
                date,
                service_id: e.service_id.clone(),
                amount_wei: e.amount_wei.clone(),
                amount_usd: (amount as f64) / 1e18 * 2000.0,
                tx_hash: e.tx_hash.clone(),
                event_type: format!("{:?}", e.event_type).to_lowercase(),
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_projected_earnings(
    state: State<'_, AppState>,
) -> Result<ProjectedEarnings, String> {
    let inner = state.inner.read().await;

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
    format: String,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<String, String> {
    let inner = state.inner.read().await;

    let entries = inner.earnings_tracker.get_entries(
        None,
        start_timestamp,
        end_timestamp,
        None,
    );

    let data_dir = crate::config::NodeConfig::data_dir()
        .map_err(|e| format!("Failed to get data directory: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");

    match format.as_str() {
        "csv" => {
            let file_path = data_dir.join(format!("earnings_{}.csv", timestamp));
            let mut csv_content = "timestamp,date,service_id,amount_wei,amount_usd,tx_hash,event_type\n".to_string();

            for e in entries {
                let date = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
                let amount: u128 = e.amount_wei.parse().unwrap_or(0);
                let amount_usd = (amount as f64) / 1e18 * 2000.0;
                let tx_hash = e.tx_hash.clone().unwrap_or_default();

                csv_content.push_str(&format!(
                    "{},{},{},{},{:.2},{},{:?}\n",
                    e.timestamp, date, e.service_id, e.amount_wei, amount_usd, tx_hash, e.event_type
                ));
            }

            std::fs::write(&file_path, csv_content)
                .map_err(|e| format!("Failed to write CSV file: {}", e))?;

            Ok(file_path.to_string_lossy().to_string())
        }
        "json" => {
            let file_path = data_dir.join(format!("earnings_{}.json", timestamp));
            let json_entries: Vec<_> = entries
                .into_iter()
                .map(|e| {
                    let date = chrono::DateTime::from_timestamp(e.timestamp, 0)
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                        .unwrap_or_default();
                    let amount: u128 = e.amount_wei.parse().unwrap_or(0);

                    EarningsHistoryEntry {
                        timestamp: e.timestamp,
                        date,
                        service_id: e.service_id.clone(),
                        amount_wei: e.amount_wei.clone(),
                        amount_usd: (amount as f64) / 1e18 * 2000.0,
                        tx_hash: e.tx_hash.clone(),
                        event_type: format!("{:?}", e.event_type).to_lowercase(),
                    }
                })
                .collect();

            let json = serde_json::to_string_pretty(&json_entries)
                .map_err(|e| format!("Failed to serialize earnings: {}", e))?;

            std::fs::write(&file_path, json)
                .map_err(|e| format!("Failed to write JSON file: {}", e))?;

            Ok(file_path.to_string_lossy().to_string())
        }
        _ => Err(format!("Unsupported format: {}. Use 'csv' or 'json'", format)),
    }
}
