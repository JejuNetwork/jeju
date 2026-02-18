use crate::state::AppState;
use alloy::primitives::{Address, U256};
use alloy::sol;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::State;

// ServiceStaking interface - per-service staking
sol! {
    #[sol(rpc)]
    interface IServiceStaking {
        function stake(string serviceId, uint256 amount) external;
        function startUnbonding(string serviceId, uint256 amount) external;
        function completeUnbonding(string serviceId) external;
        function getStake(string serviceId, address user) external view returns (
            uint256 stakedAmount,
            uint256 stakedAt,
            uint256 unbondingAmount,
            uint256 unbondingStartTime
        );
        function totalStakedByService(bytes32 serviceId) external view returns (uint256);
        function totalStakedByUser(address user) external view returns (uint256);
    }
}

// ERC20 interface for token approval
sol! {
    #[sol(rpc)]
    interface IERC20 {
        function approve(address spender, uint256 amount) external returns (bool);
        function allowance(address owner, address spender) external view returns (uint256);
        function balanceOf(address account) external view returns (uint256);
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
    use alloy::providers::{Provider, ProviderBuilder};

    let inner = state.inner.read().await;

    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let wallet_info = wallet.get_info().ok_or("Failed to get wallet info")?;
    let user_address = Address::from_str(&wallet_info.address)
        .map_err(|e| format!("Invalid wallet address: {}", e))?;

    // Get staking contract address from config
    let staking_address = &inner.config.network.contracts.compute_staking;
    if staking_address.is_empty() || staking_address == "0x0000000000000000000000000000000000000000" {
        return Ok(StakingInfo {
            total_staked_wei: "0".to_string(),
            total_staked_usd: 0.0,
            staked_by_service: vec![],
            pending_rewards_wei: "0".to_string(),
            pending_rewards_usd: 0.0,
            can_unstake: false,
            unstake_cooldown_seconds: 7 * 24 * 60 * 60,
            auto_claim_enabled: inner.config.earnings.auto_claim,
            next_auto_claim_timestamp: None,
        });
    }

    let staking_addr = Address::from_str(staking_address)
        .map_err(|e| format!("Invalid staking address: {}", e))?;

    // Create provider
    let rpc_url: alloy::transports::http::reqwest::Url = inner.config.network.rpc_url
        .parse()
        .map_err(|e| format!("Invalid RPC URL: {}", e))?;
    let provider = ProviderBuilder::new().on_http(rpc_url);

    let staking = IServiceStaking::new(staking_addr, &provider);

    // Query stakes for each service
    let service_ids = vec![
        ("storage", "Storage Node"),
        ("compute", "Compute Node"),
        ("proxy", "Proxy Node"),
        ("cron", "Cron Executor"),
        ("sequencer", "Sequencer"),
        ("rpc", "RPC Node"),
        ("xlp", "XLP Provider"),
        ("solver", "Solver"),
        ("oracle", "Oracle Node"),
    ];

    let mut total_staked: u128 = 0;
    let mut service_stakes = Vec::new();

    for (service_id, service_name) in service_ids {
        let stake_result = staking
            .getStake(service_id.to_string(), user_address)
            .call()
            .await;

        if let Ok(stake) = stake_result {
            let staked_amount: u128 = stake.stakedAmount.to::<u128>();
            if staked_amount > 0 {
                total_staked += staked_amount;
                service_stakes.push(ServiceStakeInfo {
                    service_id: service_id.to_string(),
                    service_name: service_name.to_string(),
                    staked_wei: staked_amount.to_string(),
                    staked_usd: 0.0,
                    pending_rewards_wei: "0".to_string(),
                    stake_token: inner.config.network.contracts.jeju_token.clone(),
                    min_stake_wei: "100000000000000000".to_string(), // 0.1 JEJU
                });
            }
        }
    }

    Ok(StakingInfo {
        total_staked_wei: total_staked.to_string(),
        total_staked_usd: 0.0,
        staked_by_service: service_stakes,
        pending_rewards_wei: "0".to_string(),
        pending_rewards_usd: 0.0,
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
    use alloy::sol_types::SolCall;

    let inner = state.inner.read().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get contract addresses from config
    let staking_address = &inner.config.network.contracts.compute_staking;
    let token_address = &inner.config.network.contracts.jeju_token;

    if staking_address.is_empty() || staking_address == "0x0000000000000000000000000000000000000000" {
        return Err("Staking contract not configured for this network".to_string());
    }

    let amount = U256::from_str(&request.amount_wei)
        .map_err(|e| format!("Invalid amount: {}", e))?;

    // Step 1: Approve the staking contract to spend JEJU tokens
    let approve_data = {
        let spender = Address::from_str(staking_address)
            .map_err(|e| format!("Invalid staking address: {}", e))?;
        let mut data = vec![0x09, 0x5e, 0xa7, 0xb3]; // approve(address,uint256) selector
        data.extend_from_slice(&[0u8; 12]); // pad address to 32 bytes
        data.extend_from_slice(spender.as_slice());
        data.extend_from_slice(&amount.to_be_bytes::<32>());
        hex::encode(&data)
    };

    tracing::info!("Approving {} JEJU tokens for staking contract", request.amount_wei);

    let approve_result = wallet_manager
        .send_transaction(token_address, "0", Some(&approve_data))
        .await
        .map_err(|e| format!("Failed to approve tokens: {}", e))?;

    tracing::info!("Approval tx: {}", approve_result.hash);

    // Step 2: Call stake(string serviceId, uint256 amount) on the staking contract
    let stake_call = IServiceStaking::stakeCall {
        serviceId: request.service_id.clone(),
        amount,
    };
    let stake_data = hex::encode(stake_call.abi_encode());

    tracing::info!("Staking {} JEJU tokens for service {}", request.amount_wei, request.service_id);

    let stake_result = wallet_manager
        .send_transaction(staking_address, "0", Some(&stake_data))
        .await
        .map_err(|e| format!("Failed to stake: {}", e))?;

    tracing::info!("Stake tx: {}", stake_result.hash);

    Ok(StakeResult {
        success: true,
        tx_hash: Some(stake_result.hash),
        new_stake_wei: request.amount_wei,
        error: None,
    })
}

#[tauri::command]
pub async fn unstake(
    state: State<'_, AppState>,
    request: UnstakeRequest,
) -> Result<StakeResult, String> {
    use alloy::sol_types::SolCall;

    let inner = state.inner.read().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get staking contract address from config
    let staking_address = &inner.config.network.contracts.compute_staking;

    if staking_address.is_empty() || staking_address == "0x0000000000000000000000000000000000000000" {
        return Err("Staking contract not configured for this network".to_string());
    }

    let amount = U256::from_str(&request.amount_wei)
        .map_err(|e| format!("Invalid amount: {}", e))?;

    // Call startUnbonding(string serviceId, uint256 amount) on the staking contract
    // This starts the 7-day unbonding period
    let unbond_call = IServiceStaking::startUnbondingCall {
        serviceId: request.service_id.clone(),
        amount,
    };
    let unbond_data = hex::encode(unbond_call.abi_encode());

    tracing::info!("Starting unbonding of {} JEJU tokens for service {}", request.amount_wei, request.service_id);

    let result = wallet_manager
        .send_transaction(staking_address, "0", Some(&unbond_data))
        .await
        .map_err(|e| format!("Failed to start unbonding: {}", e))?;

    tracing::info!("Unbonding tx: {}", result.hash);

    Ok(StakeResult {
        success: true,
        tx_hash: Some(result.hash),
        new_stake_wei: "0".to_string(), // Will be updated after unbonding completes
        error: None,
    })
}

#[tauri::command]
pub async fn claim_rewards(
    state: State<'_, AppState>,
    _service_id: Option<String>,
) -> Result<ClaimResult, String> {
    let inner = state.inner.read().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get staking contract address from config
    let staking_address = &inner.config.network.contracts.compute_staking;

    if staking_address.is_empty() || staking_address == "0x0000000000000000000000000000000000000000" {
        return Err("Staking contract not configured for this network".to_string());
    }

    // Call completeUnstaking() to complete the unbonding and receive tokens
    // This will fail if unbonding period hasn't completed
    let complete_data = hex::encode(&[0x68, 0x6a, 0x4f, 0x68]); // completeUnstaking() selector

    tracing::info!("Completing unstaking (claiming unbonded tokens)");

    let result = wallet_manager
        .send_transaction(staking_address, "0", Some(&complete_data))
        .await
        .map_err(|e| format!("Failed to complete unstaking: {}. Make sure the 7-day unbonding period has passed.", e))?;

    tracing::info!("Complete unstaking tx: {}", result.hash);

    Ok(ClaimResult {
        success: true,
        tx_hash: Some(result.hash),
        amount_claimed_wei: "0".to_string(), // Amount will be in tx receipt
        error: None,
    })
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
