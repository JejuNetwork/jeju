//! Compute provider registration commands
//!
//! Implements the full on-chain registration flow:
//! 1. Register Agent Identity (ERC-8004)
//! 2. Register Compute Provider (ComputeRegistry)
//! 3. Add Capabilities (models, pricing)

use crate::state::AppState;
use alloy::primitives::{Address, FixedBytes, U256};
use alloy::sol_types::SolCall;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::State;

// Import the sol interfaces
use crate::contracts::{IComputeRegistry, IIdentityRegistryV2};

/// Request to register agent identity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterAgentIdentityRequest {
    pub token_uri: String,
}

/// Request to register as compute provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterComputeProviderRequest {
    pub name: String,
    pub endpoint: String,
    pub agent_id: u64,
    pub stake_eth: String, // Amount of ETH to stake (e.g., "0.01")
}

/// Request to add compute capability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddCapabilityRequest {
    pub model: String,
    pub price_per_input_token: String,  // in wei
    pub price_per_output_token: String, // in wei
    pub max_context_length: u64,
}

/// Compute provider info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeProviderInfo {
    pub address: String,
    pub name: String,
    pub endpoint: String,
    pub agent_id: u64,
    pub stake: String,
    pub is_active: bool,
    pub registered_at: u64,
}

/// Registration result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationResult {
    pub tx_hash: String,
    pub status: String,
}

/// Register agent identity on IdentityRegistry (Step 1)
#[tauri::command]
pub async fn register_agent_identity(
    state: State<'_, AppState>,
    request: RegisterAgentIdentityRequest,
) -> Result<RegistrationResult, String> {
    let inner = state.inner.read().await;

    // Get wallet manager
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get contract addresses from config
    let identity_registry = Address::from_str(&inner.config.network.contracts.identity_registry)
        .map_err(|e| format!("Invalid identity_registry address: {}", e))?;

    // Encode the function call: register(string tokenURI)
    let call = IIdentityRegistryV2::registerCall {
        tokenURI: request.token_uri.clone(),
    };
    let calldata = call.abi_encode();

    // Send transaction
    let result = wallet
        .send_transaction(
            &format!("{:?}", identity_registry),
            "0", // No ETH value for agent registration
            Some(&hex::encode(&calldata)),
        )
        .await?;

    Ok(RegistrationResult {
        tx_hash: result.hash,
        status: "pending".to_string(),
    })
}

/// Get agent ID for current wallet
#[tauri::command]
pub async fn get_wallet_agent_id(state: State<'_, AppState>) -> Result<Option<u64>, String> {
    let inner = state.inner.read().await;

    // Get wallet address
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let wallet_info = wallet.get_info().ok_or("Failed to get wallet info")?;
    let owner = Address::from_str(&wallet_info.address)
        .map_err(|e| format!("Invalid address: {}", e))?;

    // Get contract client
    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    // Query identity registry for agent ID
    match contract_client.get_agent_by_owner(owner).await {
        Ok(Some(id)) => Ok(Some(id)),
        Ok(None) => Ok(None),
        Err(e) => {
            // If error is "not found" type, return None
            if e.contains("revert") || e.contains("not found") {
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

/// Register as compute provider on ComputeRegistry (Step 2)
#[tauri::command]
pub async fn register_compute_provider(
    state: State<'_, AppState>,
    request: RegisterComputeProviderRequest,
) -> Result<RegistrationResult, String> {
    let inner = state.inner.read().await;

    // Get wallet manager
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get contract address
    let compute_registry = Address::from_str(&inner.config.network.contracts.compute_registry)
        .map_err(|e| format!("Invalid compute_registry address: {}", e))?;

    // Parse stake amount (convert ETH string to wei)
    let stake_eth: f64 = request
        .stake_eth
        .parse()
        .map_err(|e| format!("Invalid stake amount: {}", e))?;
    let stake_wei = (stake_eth * 1e18) as u128;
    let stake_wei_str = stake_wei.to_string();

    // Empty attestation hash for now
    let attestation_hash: FixedBytes<32> = FixedBytes::ZERO;

    // Encode the function call: registerWithAgent(name, endpoint, attestationHash, agentId)
    let call = IComputeRegistry::registerWithAgentCall {
        name: request.name.clone(),
        endpoint: request.endpoint.clone(),
        attestationHash: attestation_hash,
        agentId: U256::from(request.agent_id),
    };
    let calldata = call.abi_encode();

    // Send transaction with stake value
    let result = wallet
        .send_transaction(
            &format!("{:?}", compute_registry),
            &stake_wei_str,
            Some(&hex::encode(&calldata)),
        )
        .await?;

    Ok(RegistrationResult {
        tx_hash: result.hash,
        status: "pending".to_string(),
    })
}

/// Add capability to compute provider (Step 3)
#[tauri::command]
pub async fn add_compute_capability(
    state: State<'_, AppState>,
    request: AddCapabilityRequest,
) -> Result<RegistrationResult, String> {
    let inner = state.inner.read().await;

    // Get wallet manager
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    // Get contract address
    let compute_registry = Address::from_str(&inner.config.network.contracts.compute_registry)
        .map_err(|e| format!("Invalid compute_registry address: {}", e))?;

    // Parse pricing
    let price_input = U256::from_str(&request.price_per_input_token)
        .map_err(|e| format!("Invalid input price: {}", e))?;
    let price_output = U256::from_str(&request.price_per_output_token)
        .map_err(|e| format!("Invalid output price: {}", e))?;

    // Encode the function call
    let call = IComputeRegistry::addCapabilityCall {
        model: request.model.clone(),
        pricePerInputToken: price_input,
        pricePerOutputToken: price_output,
        maxContextLength: U256::from(request.max_context_length),
    };
    let calldata = call.abi_encode();

    // Send transaction (no value)
    let result = wallet
        .send_transaction(
            &format!("{:?}", compute_registry),
            "0",
            Some(&hex::encode(&calldata)),
        )
        .await?;

    Ok(RegistrationResult {
        tx_hash: result.hash,
        status: "pending".to_string(),
    })
}

/// Get compute provider info for current wallet
#[tauri::command]
pub async fn get_compute_provider_info(
    state: State<'_, AppState>,
) -> Result<Option<ComputeProviderInfo>, String> {
    let inner = state.inner.read().await;

    // Get wallet address
    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let wallet_info = wallet.get_info().ok_or("Failed to get wallet info")?;
    let provider_address = Address::from_str(&wallet_info.address)
        .map_err(|e| format!("Invalid address: {}", e))?;

    // Get contract client
    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    // Query ComputeRegistry for provider info
    match contract_client.get_compute_provider(provider_address).await {
        Ok(Some(info)) => Ok(Some(ComputeProviderInfo {
            address: info.address,
            name: info.name,
            endpoint: info.endpoint,
            agent_id: info.agent_id,
            stake: info.stake,
            is_active: info.is_active,
            registered_at: info.registered_at,
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            if e.contains("revert") || e.contains("not registered") {
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

/// Deactivate compute provider
#[tauri::command]
pub async fn deactivate_compute_provider(
    state: State<'_, AppState>,
) -> Result<RegistrationResult, String> {
    let inner = state.inner.read().await;

    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let compute_registry = Address::from_str(&inner.config.network.contracts.compute_registry)
        .map_err(|e| format!("Invalid compute_registry address: {}", e))?;

    let call = IComputeRegistry::deactivateCall {};
    let calldata = call.abi_encode();

    let result = wallet
        .send_transaction(
            &format!("{:?}", compute_registry),
            "0",
            Some(&hex::encode(&calldata)),
        )
        .await?;

    Ok(RegistrationResult {
        tx_hash: result.hash,
        status: "pending".to_string(),
    })
}

/// Reactivate compute provider
#[tauri::command]
pub async fn reactivate_compute_provider(
    state: State<'_, AppState>,
) -> Result<RegistrationResult, String> {
    let inner = state.inner.read().await;

    let wallet = inner
        .wallet_manager
        .as_ref()
        .ok_or("Wallet not connected")?;

    let compute_registry = Address::from_str(&inner.config.network.contracts.compute_registry)
        .map_err(|e| format!("Invalid compute_registry address: {}", e))?;

    let call = IComputeRegistry::reactivateCall {};
    let calldata = call.abi_encode();

    let result = wallet
        .send_transaction(
            &format!("{:?}", compute_registry),
            "0",
            Some(&hex::encode(&calldata)),
        )
        .await?;

    Ok(RegistrationResult {
        tx_hash: result.hash,
        status: "pending".to_string(),
    })
}

/// Get minimum stake required for compute registration
#[tauri::command]
pub async fn get_min_compute_stake(state: State<'_, AppState>) -> Result<String, String> {
    let inner = state.inner.read().await;

    let contract_client = inner
        .contract_client
        .as_ref()
        .ok_or("Contract client not initialized")?;

    contract_client.get_min_compute_stake().await
}
