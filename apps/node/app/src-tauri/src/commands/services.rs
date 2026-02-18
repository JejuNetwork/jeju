//! Service management commands

use crate::hardware::HardwareDetector;
use crate::services::{ServiceId, ServiceMetadata, ServiceState};
use crate::state::AppState;
use alloy::primitives::{Address, FixedBytes, U256};
use alloy::providers::ProviderBuilder;
use alloy::sol;
use alloy::sol_types::SolCall;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use tauri::State;

// ComputeRegistry contract interface for on-chain registration
sol! {
    #[sol(rpc)]
    interface IComputeRegistry {
        function registerWithAgent(
            string calldata name,
            string calldata endpoint,
            bytes32 attestationHash,
            uint256 agentId
        ) external payable;

        function hasValidAgent(address provider) external view returns (bool);
        function getAgentByProvider(address provider) external view returns (uint256);
        function providerCount() external view returns (uint256);
    }
}


#[derive(Debug, Serialize, Deserialize)]
pub struct StartServiceRequest {
    pub service_id: String,
    pub auto_stake: bool,
    pub stake_amount: Option<String>,
    pub custom_settings: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceWithStatus {
    pub metadata: ServiceMetadata,
    pub status: ServiceState,
    pub meets_requirements: bool,
    pub requirement_issues: Vec<String>,
}

#[tauri::command]
pub async fn get_available_services(
    state: State<'_, AppState>,
) -> Result<Vec<ServiceWithStatus>, String> {
    tracing::info!("get_available_services called");
    let inner = state.inner.read().await;

    // Detect current hardware
    let mut detector = HardwareDetector::new();
    let hardware = detector.detect();
    tracing::info!("Hardware detected: {} cores, {} MB RAM", hardware.cpu.cores_physical, hardware.memory.total_mb);

    // Get all service statuses at once
    let all_statuses = inner.service_manager.get_all_status().await;
    tracing::info!("Got {} service statuses", all_statuses.len());

    // Get all services with their metadata and requirements
    let services: Vec<ServiceWithStatus> = inner
        .service_manager
        .get_available_services(&hardware)
        .into_iter()
        .map(|metadata| {
            let service_id: ServiceId = metadata.id.parse().unwrap_or(ServiceId::Compute);

            // Check requirements - use lower thresholds for basic services
            let reqs = match service_id {
                ServiceId::Compute => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 1,
                    min_memory_mb: 8 * 1024, // 8 GB for testing
                    min_storage_gb: 50,
                    requires_gpu: false,
                    min_gpu_memory_mb: None,
                    requires_tee: false,
                    min_bandwidth_mbps: Some(10),
                },
                ServiceId::Sequencer => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 4,
                    min_memory_mb: 16 * 1024,
                    min_storage_gb: 500,
                    requires_gpu: false,
                    min_gpu_memory_mb: None,
                    requires_tee: false,
                    min_bandwidth_mbps: Some(100),
                },
                _ => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 1,
                    min_memory_mb: 2 * 1024,
                    min_storage_gb: 20,
                    requires_gpu: false,
                    min_gpu_memory_mb: None,
                    requires_tee: false,
                    min_bandwidth_mbps: Some(10),
                },
            };

            let (meets, issues) = detector.meets_requirements(&hardware, &reqs);

            // Get actual service status from the service manager
            let status = all_statuses
                .get(service_id.as_str())
                .cloned()
                .unwrap_or_else(|| ServiceState {
                    running: false,
                    uptime_seconds: 0,
                    requests_served: 0,
                    earnings_wei: "0".to_string(),
                    last_error: None,
                    health: "stopped".to_string(),
                });

            ServiceWithStatus {
                metadata: metadata.clone(),
                status,
                meets_requirements: meets,
                requirement_issues: issues,
            }
        })
        .collect();

    tracing::info!("Returning {} services: {:?}", services.len(), services.iter().map(|s| &s.metadata.id).collect::<Vec<_>>());
    Ok(services)
}

#[tauri::command]
pub async fn start_service(
    state: State<'_, AppState>,
    request: StartServiceRequest,
) -> Result<ServiceState, String> {
    let mut inner = state.inner.write().await;

    // Parse service ID
    let service_id: ServiceId = request.service_id.parse()?;

    // For compute service, extract values needed for configuration before modifying config
    let (dws_url, wallet_address) = if service_id == ServiceId::Compute {
        // Determine DWS URL based on network
        let dws = match inner.config.network.network.as_str() {
            "mainnet" => "https://dws.jejunetwork.org/compute",
            "testnet" => "https://dws.testnet.jejunetwork.org/compute",
            "localnet" => "http://127.0.0.1:4030/compute",
            _ => "https://dws.testnet.jejunetwork.org/compute",
        }.to_string();

        // Get wallet address if available
        let wallet = inner.wallet_manager
            .as_ref()
            .and_then(|wm| wm.get_info())
            .map(|info| info.address);

        (Some(dws), wallet)
    } else {
        (None, None)
    };

    // For compute service, check and perform on-chain registration if needed
    if service_id == ServiceId::Compute {
        if let Some(ref wallet_addr) = wallet_address {
            // Clone to avoid borrow conflicts when we need to mutate inner later
            let registry_address = inner.config.network.contracts.compute_registry.clone();
            let rpc_url = inner.config.network.rpc_url.clone();

            // Try to get agent_id from config, or look it up using contract_client
            let agent_id = if let Some(id) = inner.config.wallet.agent_id {
                Some(id)
            } else {
                // Look up agent_id from IdentityRegistry using contract_client
                tracing::info!("No agent_id in config, looking up from IdentityRegistry...");

                if let Some(ref contract_client) = inner.contract_client {
                    let wallet = Address::from_str(wallet_addr)
                        .map_err(|e| format!("Invalid wallet address: {}", e))?;

                    match contract_client.get_agent_by_owner(wallet).await {
                        Ok(Some(id)) => {
                            tracing::info!("Found agent_id {} for wallet {}", id, wallet_addr);
                            // Save to config for future use
                            inner.config.wallet.agent_id = Some(id);
                            let _ = inner.config.save(); // Best effort save
                            Some(id)
                        }
                        Ok(None) => {
                            tracing::warn!("No agent found for wallet {}", wallet_addr);
                            None
                        }
                        Err(e) => {
                            tracing::warn!("Failed to look up agent_id: {}", e);
                            None
                        }
                    }
                } else {
                    tracing::warn!("Contract client not initialized, cannot look up agent_id");
                    None
                }
            };

            // Check if we have an agent_id
            if let Some(agent_id) = agent_id {
                // First check if the agent has enough stake on ServiceStaking contract
                const MIN_STAKE_WEI: u128 = 10_000_000_000_000_000; // 0.01 JEJU

                // Query ServiceStaking contract for compute service stake
                let compute_staking_address = inner.config.network.contracts.compute_staking.clone();

                sol! {
                    #[sol(rpc)]
                    interface IServiceStaking {
                        function getStake(string calldata serviceId, address user) external view returns (uint256 amount, uint256 since, uint256 pendingRewards);
                    }
                }

                let provider = ProviderBuilder::new()
                    .on_http(rpc_url.parse().map_err(|e| format!("Invalid RPC URL: {}", e))?);

                let staking_contract = Address::from_str(&compute_staking_address)
                    .map_err(|e| format!("Invalid staking address: {}", e))?;

                let service_staking = IServiceStaking::new(staking_contract, &provider);
                let wallet_for_stake = Address::from_str(wallet_addr)
                    .map_err(|e| format!("Invalid wallet address: {}", e))?;

                let total_staked: u128 = match service_staking
                    .getStake("compute".to_string(), wallet_for_stake)
                    .call()
                    .await
                {
                    Ok(result) => result.amount.try_into().unwrap_or(0),
                    Err(e) => {
                        tracing::warn!("Failed to get stake from ServiceStaking: {}", e);
                        0
                    }
                };

                if total_staked < MIN_STAKE_WEI {
                    let min_jeju = MIN_STAKE_WEI as f64 / 1e18;
                    let current_jeju = total_staked as f64 / 1e18;
                    return Err(format!(
                        "Insufficient stake to register compute provider. Minimum required: {} JEJU, current stake: {} JEJU. Please stake at least {} JEJU first.",
                        min_jeju, current_jeju, min_jeju
                    ));
                }

                tracing::info!("Stake check passed: {} wei staked (min: {} wei)", total_staked, MIN_STAKE_WEI);

                tracing::info!(
                    "Checking on-chain registration for wallet {} with agent {} on registry {}",
                    wallet_addr,
                    agent_id,
                    registry_address
                );

                // Check if already registered
                let provider = ProviderBuilder::new()
                    .on_http(rpc_url.parse().map_err(|e| format!("Invalid RPC URL: {}", e))?);

                let registry = Address::from_str(&registry_address)
                    .map_err(|e| format!("Invalid registry address: {}", e))?;
                let wallet_address_parsed = Address::from_str(wallet_addr)
                    .map_err(|e| format!("Invalid wallet address: {}", e))?;

                let contract = IComputeRegistry::new(registry, &provider);

                let is_registered = match contract.hasValidAgent(wallet_address_parsed).call().await {
                    Ok(result) => result._0,
                    Err(e) => {
                        tracing::warn!("Failed to check on-chain registration: {}", e);
                        false
                    }
                };

                if is_registered {
                    tracing::info!("Provider already registered on-chain with valid agent");
                } else {
                    tracing::info!("Provider not registered on-chain, initiating registration...");

                    // Build node name and endpoint
                    let node_name = format!("node-{}", &wallet_addr[2..10]);
                    let ollama_endpoint = std::env::var("OLLAMA_HOST")
                        .unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());

                    // Encode the registerWithAgent call
                    let call = IComputeRegistry::registerWithAgentCall {
                        name: node_name.clone(),
                        endpoint: ollama_endpoint.clone(),
                        attestationHash: FixedBytes::ZERO, // No TEE attestation for now
                        agentId: U256::from(agent_id),
                    };
                    let calldata = hex::encode(call.abi_encode());

                    // Send transaction using wallet_manager
                    if let Some(ref wallet_manager) = inner.wallet_manager {
                        match wallet_manager
                            .send_transaction(&registry_address, "0", Some(&calldata))
                            .await
                        {
                            Ok(result) => {
                                tracing::info!(
                                    "On-chain registration transaction sent: {} (name={}, agent_id={})",
                                    result.hash,
                                    node_name,
                                    agent_id
                                );
                            }
                            Err(e) => {
                                tracing::error!("Failed to send on-chain registration: {}", e);
                                // Don't fail startup, just log - DWS registration will still work
                            }
                        }
                    } else {
                        tracing::warn!("No wallet manager available for on-chain registration");
                    }
                }
            } else {
                tracing::warn!("No agent_id configured, skipping on-chain registration");
            }
        }
    }

    // Get or create service config
    let config = inner
        .config
        .services
        .entry(request.service_id.clone())
        .or_insert_with(crate::config::ServiceConfig::default);

    config.enabled = true;
    config.stake_amount = request.stake_amount;

    if let Some(settings) = request.custom_settings {
        config.custom_settings = settings;
    }

    // For compute service, inject DWS URL and wallet address
    if service_id == ServiceId::Compute {
        if let Some(dws) = &dws_url {
            config.custom_settings.insert(
                "dws_url".to_string(),
                serde_json::Value::String(dws.clone()),
            );
        }

        if let Some(wallet) = &wallet_address {
            config.custom_settings.insert(
                "wallet_address".to_string(),
                serde_json::Value::String(wallet.clone()),
            );
        }

        // Default Ollama endpoint - use localhost since Ollama typically binds to 127.0.0.1
        // Can be overridden via OLLAMA_HOST environment variable
        if !config.custom_settings.contains_key("ollama_endpoint") {
            let ollama_host = std::env::var("OLLAMA_HOST")
                .unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
            config.custom_settings.insert(
                "ollama_endpoint".to_string(),
                serde_json::Value::String(ollama_host),
            );
        }

        // Default models
        if !config.custom_settings.contains_key("models") {
            config.custom_settings.insert(
                "models".to_string(),
                serde_json::json!(["tinyllama"]),
            );
        }

        tracing::info!(
            "Starting compute service with DWS URL: {:?}, wallet: {:?}",
            dws_url,
            wallet_address
        );
    }

    // Clone config for service start before saving
    let service_config = config.clone();

    // Save config
    inner.config.save().map_err(|e| e.to_string())?;

    // Start service
    inner
        .service_manager
        .start_service(service_id, &service_config)
        .await?;

    // Get status
    inner.service_manager.get_service_status(service_id).await
}

#[tauri::command]
pub async fn stop_service(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceState, String> {
    let mut inner = state.inner.write().await;

    let id: ServiceId = service_id.parse()?;

    // Update config
    if let Some(config) = inner.config.services.get_mut(&service_id) {
        config.enabled = false;
    }
    inner.config.save().map_err(|e| e.to_string())?;

    // Stop service
    inner.service_manager.stop_service(id).await?;

    // Get status
    inner.service_manager.get_service_status(id).await
}

#[tauri::command]
pub async fn get_service_status(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceState, String> {
    let inner = state.inner.read().await;

    let id: ServiceId = service_id.parse()?;
    inner.service_manager.get_service_status(id).await
}

#[tauri::command]
pub async fn get_all_service_status(
    state: State<'_, AppState>,
) -> Result<HashMap<String, ServiceState>, String> {
    let inner = state.inner.read().await;
    Ok(inner.service_manager.get_all_status().await)
}
