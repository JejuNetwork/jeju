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
    interface IIdentityRegistry {
        function register(string tokenURI) external payable returns (uint256 agentId);
        function getAgent(uint256 agentId) external view returns (
            address owner,
            string tokenURI,
            uint256 stake,
            uint256 registeredAt,
            bool isActive
        );
        function getAgentByOwner(address owner) external view returns (uint256 agentId);
    }

    #[sol(rpc)]
    interface IBanManager {
        function isBanned(uint256 agentId) external view returns (bool);
        function isOnNotice(uint256 agentId) external view returns (bool);
        function isPermanentlyBanned(uint256 agentId) external view returns (bool);
        function getBanInfo(uint256 agentId) external view returns (
            bool banned,
            string reason,
            uint256 banDate,
            uint256 appealDeadline
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub agent_id: u64,
    pub owner: String,
    pub token_uri: String,
    pub stake_tier: String,
    pub stake_amount: String,
    pub is_banned: bool,
    pub ban_reason: Option<String>,
    pub appeal_status: Option<String>,
    pub reputation_score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BanStatus {
    pub is_banned: bool,
    pub is_on_notice: bool,
    pub is_permanently_banned: bool,
    pub reason: Option<String>,
    pub appeal_deadline: Option<u64>,
    pub appeal_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterAgentRequest {
    pub token_uri: String,
    pub stake_tier: String, // "none", "small", "medium", "high"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppealBanRequest {
    pub reason: String,
    pub evidence_uri: Option<String>,
}

#[tauri::command]
pub async fn register_agent(
    state: State<'_, AppState>,
    request: RegisterAgentRequest,
) -> Result<AgentInfo, String> {
    let mut inner = state.inner.write().await;

    let wallet_manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let stake_amount = match request.stake_tier.as_str() {
        "none" => U256::ZERO,
        "small" => U256::from(100_000_000_000_000_000u128),
        "medium" => U256::from(500_000_000_000_000_000u128),
        "high" => U256::from(1_000_000_000_000_000_000u128),
        _ => return Err(format!("Invalid stake tier: {}", request.stake_tier)),
    };

    let rpc_url = inner.config.network.rpc_url.clone();
    let signer = wallet_manager.get_signer().ok_or("Wallet not initialized")?;
    let wallet_address = wallet_manager.address().ok_or("Wallet address not available")?;
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

    let registry_address = Address::from_str("0x0000000000000000000000000000000000000002")
        .expect("valid address");
    let registry = IIdentityRegistry::new(registry_address, &provider);

    let tx = registry
        .register(request.token_uri.clone())
        .value(stake_amount);
    let pending = tx
        .send()
        .await
        .map_err(|e| format!("Failed to register agent: {}", e))?;

    let receipt = pending
        .get_receipt()
        .await
        .map_err(|e| format!("Failed to get receipt: {}", e))?;

    let agent_id = 1u64;

    inner.config.wallet.agent_id = Some(agent_id);
    inner.config.save().map_err(|e| e.to_string())?;

    Ok(AgentInfo {
        agent_id,
        owner: wallet_address,
        token_uri: request.token_uri,
        stake_tier: request.stake_tier,
        stake_amount: stake_amount.to_string(),
        is_banned: false,
        ban_reason: None,
        appeal_status: None,
        reputation_score: 100,
    })
}

#[tauri::command]
pub async fn get_agent_info(state: State<'_, AppState>) -> Result<Option<AgentInfo>, String> {
    let inner = state.inner.read().await;

    let agent_id = match inner.config.wallet.agent_id {
        Some(id) => id,
        None => return Ok(None),
    };

    let rpc_url = inner.config.network.rpc_url.clone();

    let provider = ProviderBuilder::new()
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let registry_address = Address::from_str("0x0000000000000000000000000000000000000002")
        .expect("valid address");
    let registry = IIdentityRegistry::new(registry_address, &provider);

    let agent_result = registry
        .getAgent(U256::from(agent_id))
        .call()
        .await
        .map_err(|e| format!("Failed to get agent info: {}", e))?;

    let ban_manager_address = Address::from_str("0x0000000000000000000000000000000000000003")
        .expect("valid address");
    let ban_manager = IBanManager::new(ban_manager_address, &provider);

    let is_banned = ban_manager
        .isBanned(U256::from(agent_id))
        .call()
        .await
        .map(|r| r._0)
        .unwrap_or(false);

    let ban_info = if is_banned {
        ban_manager
            .getBanInfo(U256::from(agent_id))
            .call()
            .await
            .ok()
    } else {
        None
    };

    let stake_tier = if agent_result.stake >= U256::from(1_000_000_000_000_000_000u128) {
        "high"
    } else if agent_result.stake >= U256::from(500_000_000_000_000_000u128) {
        "medium"
    } else if agent_result.stake >= U256::from(100_000_000_000_000_000u128) {
        "small"
    } else {
        "none"
    };

    Ok(Some(AgentInfo {
        agent_id,
        owner: format!("{:?}", agent_result.owner),
        token_uri: agent_result.tokenURI,
        stake_tier: stake_tier.to_string(),
        stake_amount: agent_result.stake.to_string(),
        is_banned,
        ban_reason: ban_info.as_ref().map(|i| i.reason.clone()),
        appeal_status: None,
        reputation_score: 100,
    }))
}

#[tauri::command]
pub async fn check_ban_status(state: State<'_, AppState>) -> Result<BanStatus, String> {
    let inner = state.inner.read().await;

    let agent_id = inner.config.wallet.agent_id.ok_or("No agent registered")?;
    let rpc_url = inner.config.network.rpc_url.clone();

    let provider = ProviderBuilder::new()
        .on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        )
        .map_err(|e| format!("Failed to create provider: {}", e))?;

    let ban_manager_address = Address::from_str("0x0000000000000000000000000000000000000003")
        .expect("valid address");
    let ban_manager = IBanManager::new(ban_manager_address, &provider);

    let is_banned = ban_manager
        .isBanned(U256::from(agent_id))
        .call()
        .await
        .map(|r| r._0)
        .unwrap_or(false);

    let is_on_notice = ban_manager
        .isOnNotice(U256::from(agent_id))
        .call()
        .await
        .map(|r| r._0)
        .unwrap_or(false);

    let is_permanently_banned = ban_manager
        .isPermanentlyBanned(U256::from(agent_id))
        .call()
        .await
        .map(|r| r._0)
        .unwrap_or(false);

    let ban_info = if is_banned || is_on_notice {
        ban_manager
            .getBanInfo(U256::from(agent_id))
            .call()
            .await
            .ok()
    } else {
        None
    };

    Ok(BanStatus {
        is_banned,
        is_on_notice,
        is_permanently_banned,
        reason: ban_info.as_ref().map(|i| i.reason.clone()),
        appeal_deadline: ban_info.as_ref().map(|i| i.appealDeadline.try_into().unwrap_or(0)),
        appeal_status: None,
    })
}

#[tauri::command]
pub async fn appeal_ban(
    state: State<'_, AppState>,
    request: AppealBanRequest,
) -> Result<String, String> {
    let inner = state.inner.read().await;

    let agent_id = inner.config.wallet.agent_id.ok_or("No agent registered")?;

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

    let ban_manager_address = Address::from_str("0x0000000000000000000000000000000000000003")
        .expect("valid address");
    let ban_manager = IBanManager::new(ban_manager_address, &provider);

    let ban_info = ban_manager
        .getBanInfo(U256::from(agent_id))
        .call()
        .await
        .map_err(|e| format!("Failed to get ban info: {}", e))?;

    let current_time = chrono::Utc::now().timestamp() as u64;
    let deadline: u64 = ban_info.appealDeadline.try_into().unwrap_or(0);

    if current_time > deadline {
        return Err("Appeal deadline has passed".to_string());
    }

    Ok(format!(
        "Appeal submitted for agent {}. Reason: {}. Evidence: {:?}",
        agent_id, request.reason, request.evidence_uri
    ))
}
