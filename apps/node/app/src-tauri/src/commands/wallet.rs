//! Wallet management commands

use crate::contracts::ContractClient;
use crate::state::AppState;
use crate::wallet::{BalanceInfo, TransactionResult, WalletInfo, WalletManager};
use alloy::primitives::Address;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
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

    // Initialize contract client
    let contract_client = ContractClient::new(&rpc_url, chain_id)
        .await
        .map_err(|e| format!("Failed to create contract client: {}", e))?;

    inner.wallet_manager = Some(manager);
    inner.contract_client = Some(contract_client);

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

    // Initialize contract client
    let contract_client = ContractClient::new(&rpc_url, chain_id)
        .await
        .map_err(|e| format!("Failed to create contract client: {}", e))?;

    inner.wallet_manager = Some(manager);
    inner.contract_client = Some(contract_client);

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

    let manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

<<<<<<< HEAD
    manager.get_balance().await
=======
    let wallet_info = manager.get_info().ok_or("Failed to get wallet info")?;
    let address =
        Address::from_str(&wallet_info.address).map_err(|e| format!("Invalid address: {}", e))?;

    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    // Fetch ETH balance
    let eth_balance = contract_client
        .get_eth_balance(address)
        .await
        .unwrap_or_default();

    // Fetch JEJU balance
    let jeju_balance = contract_client
        .get_jeju_balance(address)
        .await
        .unwrap_or_default();

    // Get staking info for totals
    let stakes = contract_client
        .get_staking_info(address)
        .await
        .unwrap_or_default();

    let mut total_staked: u128 = 0;
    let mut total_pending: u128 = 0;

    for stake in &stakes {
        total_staked += stake.staked_amount.parse::<u128>().unwrap_or(0);
        total_pending += stake.pending_rewards.parse::<u128>().unwrap_or(0);
    }

    Ok(BalanceInfo {
        eth: eth_balance.to_string(),
        jeju: jeju_balance.to_string(),
        staked: total_staked.to_string(),
        pending_rewards: total_pending.to_string(),
    })
>>>>>>> db0e2406eef4fd899ba4a5aa090db201bcbe36bf
}

#[tauri::command]
pub async fn sign_message(
    state: State<'_, AppState>,
    request: SignMessageRequest,
) -> Result<String, String> {
    let inner = state.inner.read().await;

    let manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

<<<<<<< HEAD
=======
    // Use the wallet manager's sign_message function
>>>>>>> db0e2406eef4fd899ba4a5aa090db201bcbe36bf
    manager.sign_message(&request.message).await
}

#[tauri::command]
pub async fn send_transaction(
    state: State<'_, AppState>,
    request: SendTransactionRequest,
) -> Result<TransactionResult, String> {
    let inner = state.inner.read().await;

    let manager = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not initialized")?;

<<<<<<< HEAD
=======
    // Use the wallet manager's send_transaction function
>>>>>>> db0e2406eef4fd899ba4a5aa090db201bcbe36bf
    manager
        .send_transaction(&request.to, &request.value, request.data.as_deref())
        .await
}
