use crate::state::AppState;
use alloy::primitives::Address;
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
    let inner = state.inner.write().await;

    // Verify wallet is connected
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Verify contract client
    if inner.contract_client.is_none() {
        return Err("Contract client not initialized".to_string());
    }

    let _wallet_info = wallet.get_info().ok_or("Failed to get wallet info")?;

    // Calculate stake amount based on tier
    let _stake_amount = match request.stake_tier.as_str() {
        "none" => "0",
        "small" => "100000000000000000000",   // 100 JEJU
        "medium" => "1000000000000000000000", // 1000 JEJU
        "high" => "10000000000000000000000",  // 10000 JEJU
        _ => return Err("Invalid stake tier".to_string()),
    };

    // Registration requires a signed transaction
    Err(format!(
        "To register agent with tokenURI '{}' and {} JEJU stake: \
         Use the wallet interface to sign the registration transaction on the IdentityRegistry contract.",
        request.token_uri,
        match request.stake_tier.as_str() {
            "none" => "0",
            "small" => "100",
            "medium" => "1000",
            "high" => "10000",
            _ => "0",
        }
    ))
}

#[tauri::command]
pub async fn get_agent_info(state: State<'_, AppState>) -> Result<Option<AgentInfo>, String> {
    let inner = state.inner.read().await;

    // Check if we have a stored agent ID
    let stored_agent_id = inner.config.wallet.agent_id;

    // Get contract client
    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    // If no stored agent ID, try to look up by wallet address
    let agent_id = if let Some(id) = stored_agent_id {
        id
    } else {
        // Try to get agent by owner address
        let wallet = match inner.wallet_manager.as_ref() {
            Some(w) => w,
            None => return Ok(None),
        };

        let wallet_info = match wallet.get_info() {
            Some(info) => info,
            None => return Ok(None),
        };

        let owner = Address::from_str(&wallet_info.address)
            .map_err(|e| format!("Invalid address: {}", e))?;

        match contract_client.get_agent_by_owner(owner).await {
            Ok(Some(id)) => id,
            Ok(None) => return Ok(None),
            Err(e) => return Err(format!("Failed to get agent by owner: {}", e)),
        }
    };

    // Query IdentityRegistry for agent info
    let info = contract_client
        .get_agent_info(agent_id)
        .await
        .map_err(|e| format!("Failed to get agent info: {}", e))?;

    // Determine stake tier from reputation
    let reputation: u128 = info.reputation.parse().unwrap_or(0);
    let stake_tier = if reputation >= 10000 {
        "high"
    } else if reputation >= 1000 {
        "medium"
    } else if reputation >= 100 {
        "small"
    } else {
        "none"
    };

    Ok(Some(AgentInfo {
        agent_id,
        owner: info.owner,
        token_uri: info.token_uri,
        stake_tier: stake_tier.to_string(),
        stake_amount: info.reputation.clone(),
        is_banned: info.is_banned,
        ban_reason: if info.is_banned {
            Some(info.ban_reason)
        } else {
            None
        },
        appeal_status: None,
        reputation_score: reputation as u32,
    }))
}

#[tauri::command]
pub async fn check_ban_status(state: State<'_, AppState>) -> Result<BanStatus, String> {
    let inner = state.inner.read().await;

    let agent_id = inner.config.wallet.agent_id.ok_or("No agent registered")?;

    // Get contract client
    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    // Query BanManager for status
    let ban_status = contract_client
        .get_ban_status(agent_id)
        .await
        .map_err(|e| format!("Failed to get ban status: {}", e))?;

    Ok(BanStatus {
        is_banned: ban_status.is_banned,
        is_on_notice: ban_status.is_on_notice,
        is_permanently_banned: ban_status.is_permanent,
        reason: if ban_status.is_banned {
            Some(ban_status.reason)
        } else {
            None
        },
        appeal_deadline: if ban_status.can_appeal {
            Some(ban_status.expiry)
        } else {
            None
        },
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

    // Verify wallet
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // Verify contract client
    if inner.contract_client.is_none() {
        return Err("Contract client not initialized".to_string());
    }

    // Appeal requires a signed transaction
    Err(format!(
        "To appeal ban for agent {}: Submit appeal with reason '{}' {} \
         Use the wallet interface to sign the appeal transaction on the RegistryGovernance contract.",
        agent_id,
        request.reason,
        request.evidence_uri.map_or(String::new(), |uri| format!("and evidence at '{}'.", uri))
    ))
}
