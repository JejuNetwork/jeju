//! Staking management commands

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakingInfo {
    pub total_staked_wei: String,
    pub total_staked_usd: f64,
    pub staked_by_service: Vec<ServiceStakeInfo>,
    pub pending_rewards_wei: String,
    pub pending_rewards_usd: f64,
    pub can_unstake: bool,
    pub unstake_cooldown_seconds: u64,
    pub auto_claim_enabled: bool,
    pub next_auto_claim_timestamp: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStakeInfo {
    pub service_id: String,
    pub service_name: String,
    pub staked_wei: String,
    pub staked_usd: f64,
    pub pending_rewards_wei: String,
    pub stake_token: String,
    pub min_stake_wei: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StakeRequest {
    pub service_id: String,
    pub amount_wei: String,
    pub token_address: Option<String>, // None = ETH
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnstakeRequest {
    pub service_id: String,
    pub amount_wei: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeResult {
    pub success: bool,
    pub tx_hash: Option<String>,
    pub new_stake_wei: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimResult {
    pub success: bool,
    pub tx_hash: Option<String>,
    pub amount_claimed_wei: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_staking_info(state: State<'_, AppState>) -> Result<StakingInfo, String> {
    let inner = state.inner.read().await;

    // TODO: Query all staking contracts for current stake amounts
    // 1. NodeStakingManager for RPC nodes
    // 2. ComputeStaking for compute nodes
    // 3. OracleStakingManager for oracle nodes
    // 4. SequencerRegistry for sequencers
    // 5. StorageProviderRegistry for storage

    Ok(StakingInfo {
        total_staked_wei: "0".to_string(),
        total_staked_usd: 0.0,
        staked_by_service: vec![],
        pending_rewards_wei: "0".to_string(),
        pending_rewards_usd: 0.0,
        can_unstake: false,
        unstake_cooldown_seconds: 0,
        auto_claim_enabled: inner.config.earnings.auto_claim,
        next_auto_claim_timestamp: None,
    })
}

#[tauri::command]
pub async fn stake(
    state: State<'_, AppState>,
    _request: StakeRequest,
) -> Result<StakeResult, String> {
    let inner = state.inner.read().await;

    // Verify wallet
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // TODO: Execute stake transaction
    // 1. Parse amount and token
    // 2. Approve token if needed
    // 3. Call appropriate staking contract
    // 4. Wait for confirmation

    Err("Staking not yet implemented".to_string())
}

#[tauri::command]
pub async fn unstake(
    state: State<'_, AppState>,
    _request: UnstakeRequest,
) -> Result<StakeResult, String> {
    let inner = state.inner.read().await;

    // Verify wallet
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // TODO: Execute unstake transaction
    // 1. Check if unstake is allowed (cooldown period)
    // 2. Call appropriate staking contract
    // 3. Wait for confirmation

    Err("Unstaking not yet implemented".to_string())
}

#[tauri::command]
pub async fn claim_rewards(
    state: State<'_, AppState>,
    _service_id: Option<String>,
) -> Result<ClaimResult, String> {
    let inner = state.inner.read().await;

    // Verify wallet
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // TODO: Claim rewards from staking contracts
    // 1. If service_id specified, claim from that service
    // 2. Otherwise, claim from all services
    // 3. Return total claimed

    Err("Claim rewards not yet implemented".to_string())
}

#[tauri::command]
pub async fn enable_auto_claim(
    state: State<'_, AppState>,
    enabled: bool,
    threshold_wei: Option<String>,
    interval_hours: Option<u32>,
) -> Result<(), String> {
    let mut inner = state.inner.write().await;

    inner.config.earnings.auto_claim = enabled;

    if let Some(threshold) = threshold_wei {
        inner.config.earnings.auto_claim_threshold_wei = threshold;
    }

    if let Some(interval) = interval_hours {
        inner.config.earnings.auto_claim_interval_hours = interval;
    }

    inner.config.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_pending_rewards(
    _state: State<'_, AppState>,
) -> Result<Vec<ServiceStakeInfo>, String> {
    // TODO: Query all staking contracts for pending rewards

    Ok(vec![])
}
