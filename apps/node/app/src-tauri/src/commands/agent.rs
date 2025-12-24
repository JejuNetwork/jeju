//! ERC-8004 Agent registration commands

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    let inner = state.inner.read();

    // Verify wallet is connected
    if inner.wallet_manager.is_none() {
        return Err("Wallet not connected".to_string());
    }

    // TODO: Call IdentityRegistry.register()
    // 1. Determine stake amount based on tier
    // 2. Approve token spending if needed
    // 3. Call register() with tokenURI and stake
    // 4. Return agent info

    Err("Agent registration not yet implemented".to_string())
}

#[tauri::command]
pub async fn get_agent_info(state: State<'_, AppState>) -> Result<Option<AgentInfo>, String> {
    let inner = state.inner.read();

    let agent_id = inner.config.wallet.agent_id;

    if agent_id.is_none() {
        return Ok(None);
    }

    // TODO: Query IdentityRegistry for agent info
    // 1. Get agent metadata
    // 2. Get reputation score
    // 3. Check ban status

    Err("Get agent info not yet implemented".to_string())
}

#[tauri::command]
pub async fn check_ban_status(state: State<'_, AppState>) -> Result<BanStatus, String> {
    let inner = state.inner.read();

    let agent_id = inner.config.wallet.agent_id.ok_or("No agent registered")?;

    // TODO: Query BanManager for status
    // 1. Check isBanned()
    // 2. Check isOnNotice()
    // 3. Check isPermanentlyBanned()
    // 4. Get ban reason if applicable
    // 5. Check for pending appeals

    Ok(BanStatus {
        is_banned: false,
        is_on_notice: false,
        is_permanently_banned: false,
        reason: None,
        appeal_deadline: None,
        appeal_status: None,
    })
}

#[tauri::command]
pub async fn appeal_ban(
    state: State<'_, AppState>,
    request: AppealBanRequest,
) -> Result<String, String> {
    let inner = state.inner.read();

    let agent_id = inner.config.wallet.agent_id.ok_or("No agent registered")?;

    // TODO: Submit appeal via RegistryGovernance
    // 1. Check if appeal is possible (within deadline, has stake)
    // 2. Submit appeal with reason and evidence
    // 3. Return appeal ID / status

    Err("Appeal ban not yet implemented".to_string())
}
