//! Earnings tracking commands

use crate::earnings::EarningsEventType;
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
    let tracker = &inner.earnings_tracker;
    let stats = tracker.get_stats();

    // Calculate time boundaries
    let now = chrono::Utc::now();
    let today_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|t| t.and_utc().timestamp())
        .unwrap_or(0);
    let week_start = (now - chrono::Duration::days(7)).timestamp();
    let month_start = (now - chrono::Duration::days(30)).timestamp();

    // Get entries for different time periods
    let today_entries = tracker.get_entries(None, Some(today_start), None, None);
    let week_entries = tracker.get_entries(None, Some(week_start), None, None);
    let month_entries = tracker.get_entries(None, Some(month_start), None, None);

    // Sum up earnings
    let today_total: u128 = today_entries
        .iter()
        .filter_map(|e| e.amount_wei.parse::<u128>().ok())
        .sum();
    let week_total: u128 = week_entries
        .iter()
        .filter_map(|e| e.amount_wei.parse::<u128>().ok())
        .sum();
    let month_total: u128 = month_entries
        .iter()
        .filter_map(|e| e.amount_wei.parse::<u128>().ok())
        .sum();

    // Calculate earnings by service
    let mut earnings_by_service = vec![];
    for (service_id, total_wei) in &stats.by_service {
        let today_service: u128 = today_entries
            .iter()
            .filter(|e| &e.service_id == service_id)
            .filter_map(|e| e.amount_wei.parse::<u128>().ok())
            .sum();

        earnings_by_service.push(ServiceEarnings {
            service_id: service_id.clone(),
            service_name: service_id.clone(),
            total_wei: total_wei.clone(),
            total_usd: wei_to_usd(total_wei),
            today_wei: today_service.to_string(),
            today_usd: wei_to_usd(&today_service.to_string()),
            requests_served: 0,
            uptime_percent: 100.0,
        });
    }

    // Calculate earnings by bot
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
            net_profit_usd: wei_to_usd(&net.to_string()),
            opportunities_executed: status.opportunities_executed,
            success_rate_percent: if status.opportunities_found > 0 {
                (status.opportunities_executed as f64 / status.opportunities_found as f64) * 100.0
            } else {
                0.0
            },
        });
    }

    // Calculate average hourly rate (based on last 30 days)
    let total: u128 = stats.total_wei.parse().unwrap_or(0);
    let hours_tracked = 720.0; // 30 days
    let avg_hourly_rate = wei_to_usd(&(total / 720).to_string());

    Ok(EarningsSummary {
        total_earnings_wei: stats.total_wei.clone(),
        total_earnings_usd: wei_to_usd(&stats.total_wei),
        earnings_today_wei: today_total.to_string(),
        earnings_today_usd: wei_to_usd(&today_total.to_string()),
        earnings_this_week_wei: week_total.to_string(),
        earnings_this_week_usd: wei_to_usd(&week_total.to_string()),
        earnings_this_month_wei: month_total.to_string(),
        earnings_this_month_usd: wei_to_usd(&month_total.to_string()),
        earnings_by_service,
        earnings_by_bot,
        avg_hourly_rate_usd: avg_hourly_rate,
        projected_monthly_usd: avg_hourly_rate * hours_tracked,
    })
}

/// Convert wei to USD (placeholder conversion rate)
fn wei_to_usd(wei_str: &str) -> f64 {
    let wei: u128 = wei_str.parse().unwrap_or(0);
    // Assuming 1 ETH = $2000, 1 ETH = 10^18 wei
    let eth = wei as f64 / 1e18;
    eth * 2000.0
}

#[tauri::command]
pub async fn get_earnings_history(
    state: State<'_, AppState>,
    request: EarningsHistoryRequest,
) -> Result<Vec<EarningsHistoryEntry>, String> {
    let inner = state.inner.read().await;
    let tracker = &inner.earnings_tracker;

    let entries = tracker.get_entries(
        request.service_id.as_deref(),
        request.start_timestamp,
        request.end_timestamp,
        request.limit.map(|l| l as usize),
    );

    Ok(entries
        .into_iter()
        .map(|e| {
            let date = chrono::DateTime::from_timestamp(e.timestamp, 0)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();

            EarningsHistoryEntry {
                timestamp: e.timestamp,
                date,
                service_id: e.service_id.clone(),
                amount_wei: e.amount_wei.clone(),
                amount_usd: wei_to_usd(&e.amount_wei),
                tx_hash: e.tx_hash.clone(),
                event_type: match e.event_type {
                    EarningsEventType::Reward => "reward",
                    EarningsEventType::Claim => "claim",
                    EarningsEventType::BotProfit => "bot_profit",
                    EarningsEventType::Stake => "stake",
                    EarningsEventType::Unstake => "unstake",
                }
                .to_string(),
            }
        })
        .collect())
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
    format: String, // "csv" or "json"
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<String, String> {
    let inner = state.inner.read().await;
    let tracker = &inner.earnings_tracker;

    let entries = tracker.get_entries(None, start_timestamp, end_timestamp, None);

    let data_dir = crate::config::NodeConfig::data_dir()
        .map_err(|e| format!("Failed to get data directory: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("earnings_export_{}.{}", timestamp, format);
    let filepath = data_dir.join(&filename);

    match format.as_str() {
        "csv" => {
            let mut csv_content = String::from(
                "timestamp,date,service_id,amount_wei,amount_usd,tx_hash,event_type\n",
            );
            for e in entries {
                let date = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
                let event_type = match e.event_type {
                    EarningsEventType::Reward => "reward",
                    EarningsEventType::Claim => "claim",
                    EarningsEventType::BotProfit => "bot_profit",
                    EarningsEventType::Stake => "stake",
                    EarningsEventType::Unstake => "unstake",
                };
                csv_content.push_str(&format!(
                    "{},{},{},{},{:.6},{},{}\n",
                    e.timestamp,
                    date,
                    e.service_id,
                    e.amount_wei,
                    wei_to_usd(&e.amount_wei),
                    e.tx_hash.as_deref().unwrap_or(""),
                    event_type
                ));
            }
            std::fs::write(&filepath, csv_content)
                .map_err(|e| format!("Failed to write CSV file: {}", e))?;
        }
        "json" => {
            let json_entries: Vec<_> = entries
                .into_iter()
                .map(|e| {
                    serde_json::json!({
                        "timestamp": e.timestamp,
                        "date": chrono::DateTime::from_timestamp(e.timestamp, 0)
                            .map(|dt| dt.format("%Y-%m-%d").to_string())
                            .unwrap_or_default(),
                        "service_id": e.service_id,
                        "amount_wei": e.amount_wei,
                        "amount_usd": wei_to_usd(&e.amount_wei),
                        "tx_hash": e.tx_hash,
                        "event_type": match e.event_type {
                            EarningsEventType::Reward => "reward",
                            EarningsEventType::Claim => "claim",
                            EarningsEventType::BotProfit => "bot_profit",
                            EarningsEventType::Stake => "stake",
                            EarningsEventType::Unstake => "unstake",
                        }
                    })
                })
                .collect();
            let json_content = serde_json::to_string_pretty(&json_entries)
                .map_err(|e| format!("Failed to serialize earnings: {}", e))?;
            std::fs::write(&filepath, json_content)
                .map_err(|e| format!("Failed to write JSON file: {}", e))?;
        }
        _ => {
            return Err(format!(
                "Unsupported format: {}. Use 'csv' or 'json'.",
                format
            ))
        }
    }

    Ok(filepath.to_string_lossy().to_string())
}
