//! Earnings tracking and history

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsEntry {
    pub id: String,
    pub timestamp: i64,
    pub service_id: String,
    pub amount_wei: String,
    pub tx_hash: Option<String>,
    pub event_type: EarningsEventType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EarningsEventType {
    Reward,
    Claim,
    BotProfit,
    Stake,
    Unstake,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarningsStats {
    pub total_wei: String,
    pub total_usd: f64,
    pub by_service: HashMap<String, String>,
    pub by_day: HashMap<String, String>,
}

pub struct EarningsTracker {
    entries: Vec<EarningsEntry>,
    stats: EarningsStats,
}

#[allow(dead_code)]
impl EarningsTracker {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            stats: EarningsStats {
                total_wei: "0".to_string(),
                total_usd: 0.0,
                by_service: HashMap::new(),
                by_day: HashMap::new(),
            },
        }
    }

    pub fn load(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let data_dir = crate::config::NodeConfig::data_dir()?;
        let earnings_path = data_dir.join("earnings.json");

        if earnings_path.exists() {
            let contents = std::fs::read_to_string(&earnings_path)?;
            let data: EarningsData = serde_json::from_str(&contents)?;
            self.entries = data.entries;
            self.stats = data.stats;
        }

        Ok(())
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let data_dir = crate::config::NodeConfig::data_dir()?;
        std::fs::create_dir_all(&data_dir)?;

        let earnings_path = data_dir.join("earnings.json");

        let data = EarningsData {
            entries: self.entries.clone(),
            stats: self.stats.clone(),
        };

        let contents = serde_json::to_string_pretty(&data)?;
        std::fs::write(&earnings_path, contents)?;

        Ok(())
    }

    pub fn add_entry(&mut self, entry: EarningsEntry) {
        // Update stats
        let amount: u128 = entry.amount_wei.parse().unwrap_or(0);
        let current_total: u128 = self.stats.total_wei.parse().unwrap_or(0);
        self.stats.total_wei = (current_total + amount).to_string();

        // Update by service
        let service_total: u128 = self
            .stats
            .by_service
            .get(&entry.service_id)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        self.stats.by_service.insert(
            entry.service_id.clone(),
            (service_total + amount).to_string(),
        );

        // Update by day
        let date = chrono::DateTime::from_timestamp(entry.timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();

        let day_total: u128 = self
            .stats
            .by_day
            .get(&date)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        self.stats
            .by_day
            .insert(date, (day_total + amount).to_string());

        self.entries.push(entry);

        // Save
        let _ = self.save();
    }

    pub fn get_entries(
        &self,
        service_id: Option<&str>,
        start_time: Option<i64>,
        end_time: Option<i64>,
        limit: Option<usize>,
    ) -> Vec<&EarningsEntry> {
        let mut filtered: Vec<&EarningsEntry> = self
            .entries
            .iter()
            .filter(|e| {
                if let Some(sid) = service_id {
                    if e.service_id != sid {
                        return false;
                    }
                }
                if let Some(start) = start_time {
                    if e.timestamp < start {
                        return false;
                    }
                }
                if let Some(end) = end_time {
                    if e.timestamp > end {
                        return false;
                    }
                }
                true
            })
            .collect();

        // Sort by timestamp descending
        filtered.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(lim) = limit {
            filtered.truncate(lim);
        }

        filtered
    }

    pub fn get_stats(&self) -> &EarningsStats {
        &self.stats
    }

    pub fn get_total_today(&self) -> String {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        self.stats
            .by_day
            .get(&today)
            .cloned()
            .unwrap_or_else(|| "0".to_string())
    }

    /// Get earnings entries for a specific bot within the given number of days
    pub fn get_bot_earnings(&self, bot_id: &str, days: u32) -> Vec<BotEarningsEntry> {
        let now = chrono::Utc::now().timestamp();
        let start_time = now - (days as i64 * 24 * 60 * 60);

        self.entries
            .iter()
            .filter(|e| {
                e.service_id == bot_id
                    && matches!(e.event_type, EarningsEventType::BotProfit)
                    && e.timestamp >= start_time
            })
            .map(|e| BotEarningsEntry {
                id: e.id.clone(),
                timestamp: e.timestamp,
                amount_wei: e.amount_wei.clone(),
                tx_hash: e.tx_hash.clone(),
                category: "bot_profit".to_string(),
            })
            .collect()
    }
}

/// Bot earnings entry for external consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotEarningsEntry {
    pub id: String,
    pub timestamp: i64,
    pub amount_wei: String,
    pub tx_hash: Option<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EarningsData {
    entries: Vec<EarningsEntry>,
    stats: EarningsStats,
}

impl Default for EarningsTracker {
    fn default() -> Self {
        Self::new()
    }
}
