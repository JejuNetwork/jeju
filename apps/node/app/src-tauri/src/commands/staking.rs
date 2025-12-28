use crate::state::AppState;
use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
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
        function pendingRewards(address operator) external view returns (uint256);
        function claimRewards() external returns (uint256);
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

    let wallet_manager = match &inner.wallet_manager {
        Some(m) => m,
        None => {
            return Ok(StakingInfo {
                total_staked_wei: "0".to_string(),
                total_staked_usd: 0.0,
                staked_by_service: vec![],
                pending_rewards_wei: "0".to_string(),
                pending_rewards_usd: 0.0,
                can_unstake: false,
                unstake_cooldown_seconds: 0,
                auto_claim_enabled: inner.config.earnings.auto_claim,
                next_auto_claim_timestamp: None,
            });
        }
    };

    let rpc_url = inner.config.network.rpc_url.clone();
    let wallet_address = wallet_manager
        .address()
        .ok_or("Wallet address not available")?;
    let address =
        Address::from_str(&wallet_address).map_err(|e| format!("Invalid address: {}", e))?;

    let provider = ProviderBuilder::new()
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let mut total_staked = U256::ZERO;
    let mut total_pending = U256::ZERO;
    let mut staked_by_service = vec![];

    let compute_staking_address = Address::from_str("0x0000000000000000000000000000000000000001")
        .expect("valid address");
    let compute_contract = IComputeStaking::new(compute_staking_address, &provider);

    if let Ok(stake_result) = compute_contract.getStake(address).call().await {
        let stake_amount = stake_result.amount;
        if stake_amount > U256::ZERO {
            total_staked += stake_amount;
            staked_by_service.push(ServiceStakeInfo {
                service_id: "compute".to_string(),
                service_name: "Compute Provider".to_string(),
                staked_wei: stake_amount.to_string(),
                staked_usd: 0.0,
                pending_rewards_wei: "0".to_string(),
                stake_token: "ETH".to_string(),
                min_stake_wei: "100000000000000000".to_string(),
            });
        }
    }

    if let Ok(pending) = compute_contract.pendingRewards(address).call().await {
        total_pending += pending._0;
    }

    Ok(StakingInfo {
        total_staked_wei: total_staked.to_string(),
        total_staked_usd: 0.0,
        staked_by_service,
        pending_rewards_wei: total_pending.to_string(),
        pending_rewards_usd: 0.0,
        can_unstake: total_staked > U256::ZERO,
        unstake_cooldown_seconds: 0,
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

    let amount = U256::from_str(&request.amount_wei)
        .map_err(|e| format!("Invalid amount: {}", e))?;

    let rpc_url = inner.config.network.rpc_url.clone();
    let signer = wallet_manager.get_signer().ok_or("Wallet not initialized")?;
    let wallet = EthereumWallet::from(signer.clone());

    let provider = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let compute_staking_address = Address::from_str("0x0000000000000000000000000000000000000001")
        .expect("valid address");
    let compute_contract = IComputeStaking::new(compute_staking_address, &provider);

    let tx = compute_contract.stakeAsProvider().value(amount);
    let pending = tx
        .send()
        .await
        .map_err(|e| format!("Failed to send stake transaction: {}", e))?;

    let tx_hash = pending.tx_hash();

    Ok(StakeResult {
        success: true,
        tx_hash: Some(format!("{:?}", tx_hash)),
        new_stake_wei: request.amount_wei,
        error: None,
    })
}

#[tauri::command]
pub async fn unstake(
    state: State<'_, AppState>,
    _request: UnstakeRequest,
) -> Result<StakeResult, String> {
    let inner = state.inner.read().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let rpc_url = inner.config.network.rpc_url.clone();
    let signer = wallet_manager.get_signer().ok_or("Wallet not initialized")?;
    let wallet = EthereumWallet::from(signer.clone());

    let provider = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let compute_staking_address = Address::from_str("0x0000000000000000000000000000000000000001")
        .expect("valid address");
    let compute_contract = IComputeStaking::new(compute_staking_address, &provider);

    let tx = compute_contract.unstake();
    let pending = tx
        .send()
        .await
        .map_err(|e| format!("Failed to send unstake transaction: {}", e))?;

    let tx_hash = pending.tx_hash();

    Ok(StakeResult {
        success: true,
        tx_hash: Some(format!("{:?}", tx_hash)),
        new_stake_wei: "0".to_string(),
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

    let rpc_url = inner.config.network.rpc_url.clone();
    let signer = wallet_manager.get_signer().ok_or("Wallet not initialized")?;
    let wallet = EthereumWallet::from(signer.clone());

    let provider = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let compute_staking_address = Address::from_str("0x0000000000000000000000000000000000000001")
        .expect("valid address");
    let compute_contract = IComputeStaking::new(compute_staking_address, &provider);

    let tx = compute_contract.claimRewards();
    let pending = tx
        .send()
        .await
        .map_err(|e| format!("Failed to claim rewards: {}", e))?;

    let tx_hash = pending.tx_hash();

    Ok(ClaimResult {
        success: true,
        tx_hash: Some(format!("{:?}", tx_hash)),
        amount_claimed_wei: "0".to_string(),
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

    let wallet_manager = match &inner.wallet_manager {
        Some(m) => m,
        None => return Ok(vec![]),
    };

    let rpc_url = inner.config.network.rpc_url.clone();
    let wallet_address = wallet_manager.address().ok_or("Wallet address not available")?;
    let address = Address::from_str(&wallet_address).map_err(|e| format!("Invalid address: {}", e))?;

    let provider = ProviderBuilder::new()
        .on_http(rpc_url.parse().map_err(|e| format!("Invalid RPC URL: {}", e))?)
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let mut results = vec![];

    let compute_staking_address = Address::from_str("0x0000000000000000000000000000000000000001")
        .expect("valid address");
    let compute_contract = IComputeStaking::new(compute_staking_address, &provider);

    if let Ok(pending) = compute_contract.pendingRewards(address).call().await {
        if pending._0 > U256::ZERO {
            results.push(ServiceStakeInfo {
                service_id: "compute".to_string(),
                service_name: "Compute Provider".to_string(),
                staked_wei: "0".to_string(),
                staked_usd: 0.0,
                pending_rewards_wei: pending._0.to_string(),
                stake_token: "ETH".to_string(),
                min_stake_wei: "100000000000000000".to_string(),
            });
        }
    }

    Ok(results)
}
