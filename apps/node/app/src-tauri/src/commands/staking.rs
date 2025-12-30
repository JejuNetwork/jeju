use crate::state::AppState;
use alloy::primitives::Address;
use alloy::sol;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::State;

sol! {
    #[sol(rpc)]
    interface IComputeStaking {
        function stakeAsProvider() external payable;
        function getStake(address staker) external view returns (uint256 amount, uint8 stakeType, uint256 stakedAt);
        function unstake() external;
        function pendingRewards(address staker) external view returns (uint256);
        function claimRewards() external returns (uint256);
    }
}

sol! {
    #[sol(rpc)]
    interface INodeStakingManager {
        function getNodeInfo(address operator) external view returns (
            address stakeToken,
            uint256 stakeAmount,
            address rewardToken,
            string rpcUrl,
            string region,
            uint256 registeredAt,
            uint256 uptime,
            uint256 requestsServed
        );
        function nodePendingRewards(address operator) external view returns (uint256);
        function nodeClaimRewards() external returns (uint256);
    }
}

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

    // Get contract client and wallet
    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized. Connect wallet first.")?;

    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let wallet_info = wallet.get_info().ok_or("Failed to get wallet info")?;
    let operator = Address::from_str(&wallet_info.address)
        .map_err(|e| format!("Invalid wallet address: {}", e))?;

    // Query staking contracts for current stake amounts
    let stakes = contract_client
        .get_staking_info(operator)
        .await
        .unwrap_or_default();

    // Aggregate stake info
    let mut total_staked: u128 = 0;
    let mut total_staked_usd: f64 = 0.0;
    let mut total_pending: u128 = 0;
    let mut service_stakes = Vec::new();

    for stake in stakes {
        let staked_amount: u128 = stake.staked_amount.parse().unwrap_or(0);
        let staked_usd: f64 = stake.staked_value_usd.parse().unwrap_or(0.0) / 1e18;
        let pending: u128 = stake.pending_rewards.parse().unwrap_or(0);

        total_staked += staked_amount;
        total_staked_usd += staked_usd;
        total_pending += pending;

        service_stakes.push(ServiceStakeInfo {
            service_id: stake.node_id.clone(),
            service_name: format!("Node {}", &stake.node_id[..10]),
            staked_wei: stake.staked_amount,
            staked_usd,
            pending_rewards_wei: stake.pending_rewards,
            stake_token: stake.staking_token,
            min_stake_wei: "1000000000000000000000".to_string(), // 1000 JEJU minimum
        });
    }

    Ok(StakingInfo {
        total_staked_wei: total_staked.to_string(),
        total_staked_usd,
        staked_by_service: service_stakes,
        pending_rewards_wei: total_pending.to_string(),
        pending_rewards_usd: (total_pending as f64) / 1e18,
        can_unstake: total_staked > 0,
        unstake_cooldown_seconds: 7 * 24 * 60 * 60, // 7 days
        auto_claim_enabled: inner.config.earnings.auto_claim,
        next_auto_claim_timestamp: None,
    })
}

#[tauri::command]
pub async fn stake(
    state: State<'_, AppState>,
    request: StakeRequest,
) -> Result<StakeResult, String> {
    let inner = state.inner.read().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Verify contract client
    if inner.contract_client.is_none() {
        return Err("Contract client not initialized".to_string());
    }

    // Staking requires a signed transaction
    Err(format!(
        "To stake {} wei to service {}: Use the wallet interface to sign the staking transaction. \
         Token: {}",
        request.amount_wei,
        request.service_id,
        request.token_address.unwrap_or_else(|| "JEJU".to_string())
    ))
}

#[tauri::command]
pub async fn unstake(
    state: State<'_, AppState>,
    request: UnstakeRequest,
) -> Result<StakeResult, String> {
    let inner = state.inner.read().await;

    let _wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Verify contract client
    if inner.contract_client.is_none() {
        return Err("Contract client not initialized".to_string());
    }

    // Unstaking requires a signed transaction
    Err(format!(
        "To unstake {} wei from service {}: Use the wallet interface to sign the unstake transaction.",
        request.amount_wei, request.service_id
    ))
}

#[tauri::command]
pub async fn claim_rewards(
    state: State<'_, AppState>,
    service_id: Option<String>,
) -> Result<ClaimResult, String> {
    let inner = state.inner.read().await;

    let _wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Verify contract client
    if inner.contract_client.is_none() {
        return Err("Contract client not initialized".to_string());
    }

    // Claiming requires a signed transaction
    match service_id {
        Some(id) => Err(format!(
            "To claim rewards from service {}: Use the wallet interface to sign the claim transaction.",
            id
        )),
        None => Err(
            "To claim all rewards: Use the wallet interface to sign the claim transaction."
                .to_string(),
        ),
    }
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
    state: State<'_, AppState>,
) -> Result<Vec<ServiceStakeInfo>, String> {
    let inner = state.inner.read().await;

    // Get contract client and wallet
    let contract_client = match inner.contract_client.as_ref() {
        Some(client) => client,
        None => return Ok(vec![]),
    };

    let wallet = match inner.wallet_manager.as_ref() {
        Some(w) => w,
        None => return Ok(vec![]),
    };

    let wallet_info = match wallet.get_info() {
        Some(info) => info,
        None => return Ok(vec![]),
    };

    let operator =
        Address::from_str(&wallet_info.address).map_err(|e| format!("Invalid address: {}", e))?;

    // Query staking contracts for pending rewards
    let stakes = contract_client
        .get_staking_info(operator)
        .await
        .unwrap_or_default();

    let mut result = Vec::new();
    for stake in stakes {
        let pending: u128 = stake.pending_rewards.parse().unwrap_or(0);
        if pending > 0 {
            result.push(ServiceStakeInfo {
                service_id: stake.node_id.clone(),
                service_name: format!("Node {}", &stake.node_id[..10]),
                staked_wei: stake.staked_amount,
                staked_usd: stake.staked_value_usd.parse().unwrap_or(0.0) / 1e18,
                pending_rewards_wei: stake.pending_rewards,
                stake_token: stake.staking_token,
                min_stake_wei: "1000000000000000000000".to_string(),
            });
        }
    }

    Ok(result)
}
