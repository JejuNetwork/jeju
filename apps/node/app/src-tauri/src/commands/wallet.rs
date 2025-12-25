//! Wallet management commands

use crate::state::AppState;
use crate::wallet::{BalanceInfo, TransactionResult, WalletInfo, WalletManager};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWalletRequest {
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportWalletRequest {
    pub private_key: Option<String>,
    pub mnemonic: Option<String>,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SignMessageRequest {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendTransactionRequest {
    pub to: String,
    pub value: String,
    pub data: Option<String>,
}

#[tauri::command]
pub async fn create_wallet(
    state: State<'_, AppState>,
    request: CreateWalletRequest,
) -> Result<WalletInfo, String> {
    let mut inner = state.inner.write().await;

    let rpc_url = inner.config.network.rpc_url.clone();
    let chain_id = inner.config.network.chain_id;

    let mut manager = WalletManager::new(&rpc_url, chain_id);
    let info = manager.create_wallet(&request.password)?;

    inner.wallet_manager = Some(manager);

    // Update config
    inner.config.wallet.wallet_type = crate::config::WalletType::Embedded;
    inner.config.wallet.address = Some(info.address.clone());
    inner.config.save().map_err(|e| e.to_string())?;

    Ok(info)
}

#[tauri::command]
pub async fn import_wallet(
    state: State<'_, AppState>,
    request: ImportWalletRequest,
) -> Result<WalletInfo, String> {
    let mut inner = state.inner.write().await;

    let rpc_url = inner.config.network.rpc_url.clone();
    let chain_id = inner.config.network.chain_id;

    let mut manager = WalletManager::new(&rpc_url, chain_id);

    let info = if let Some(pk) = request.private_key {
        manager.import_wallet(&pk, &request.password)?
    } else if let Some(mnemonic) = request.mnemonic {
        manager.import_from_mnemonic(&mnemonic, &request.password)?
    } else {
        return Err("Either private_key or mnemonic required".to_string());
    };

    inner.wallet_manager = Some(manager);

    // Update config
    inner.config.wallet.wallet_type = crate::config::WalletType::Embedded;
    inner.config.wallet.address = Some(info.address.clone());
    inner.config.save().map_err(|e| e.to_string())?;

    Ok(info)
}

#[tauri::command]
pub async fn get_wallet_info(state: State<'_, AppState>) -> Result<Option<WalletInfo>, String> {
    let inner = state.inner.read().await;

    if let Some(ref manager) = inner.wallet_manager {
        Ok(manager.get_info())
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_balance(state: State<'_, AppState>) -> Result<BalanceInfo, String> {
    let inner = state.inner.read().await;

    let _manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

    // Clone manager for async operation
    drop(inner);

    // TODO: Implement actual balance fetching
    Ok(BalanceInfo {
        eth: "0".to_string(),
        jeju: "0".to_string(),
        staked: "0".to_string(),
        pending_rewards: "0".to_string(),
    })
}

#[tauri::command]
pub async fn sign_message(
    state: State<'_, AppState>,
    _request: SignMessageRequest,
) -> Result<String, String> {
    let inner = state.inner.read().await;

    let _manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

    // TODO: Implement actual signing
    Err("Sign message not yet implemented".to_string())
}

#[tauri::command]
pub async fn send_transaction(
    state: State<'_, AppState>,
    _request: SendTransactionRequest,
) -> Result<TransactionResult, String> {
    let inner = state.inner.read().await;

    let _manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

    // TODO: Implement actual transaction sending
    Err("Send transaction not yet implemented".to_string())
}
