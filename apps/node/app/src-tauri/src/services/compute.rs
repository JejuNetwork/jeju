//! Compute service - AI inference provider
//!
//! Registers with DWS (Decentralized Web Services) to receive inference requests
//! and routes them to local Ollama instance.

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

/// Request body for DWS node registration
#[derive(Debug, Serialize)]
struct DWSRegisterRequest {
    address: String,
    #[serde(rename = "gpuTier")]
    gpu_tier: u32,
    name: Option<String>,
    endpoint: Option<String>,
    capabilities: Option<Vec<String>>,
    models: Option<Vec<String>>,
    provider: Option<String>,
    region: Option<String>,
    #[serde(rename = "maxConcurrent")]
    max_concurrent: Option<u32>,
}

/// Request body for DWS heartbeat
#[derive(Debug, Serialize)]
struct DWSHeartbeatRequest {
    address: String,
    load: Option<u32>,
}

/// Response from DWS registration
#[derive(Debug, Deserialize)]
struct DWSRegisterResponse {
    success: bool,
    address: String,
    #[serde(rename = "gpuTier")]
    gpu_tier: u32,
}

pub struct ComputeService {
    rpc_url: String,
    dws_url: Arc<RwLock<Option<String>>>,
    wallet_address: Arc<RwLock<Option<String>>>,
    ollama_endpoint: Arc<RwLock<String>>,
    models: Arc<RwLock<Vec<String>>>,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    requests_served: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ComputeService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            dws_url: Arc::new(RwLock::new(None)),
            wallet_address: Arc::new(RwLock::new(None)),
            ollama_endpoint: Arc::new(RwLock::new("http://localhost:11434".to_string())),
            models: Arc::new(RwLock::new(vec!["tinyllama".to_string()])),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            requests_served: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }

    /// Set the DWS URL for registration
    pub async fn set_dws_url(&self, url: String) {
        *self.dws_url.write().await = Some(url);
    }

    /// Set the wallet address for registration
    pub async fn set_wallet_address(&self, address: String) {
        *self.wallet_address.write().await = Some(address);
    }

    /// Set the Ollama endpoint URL
    pub async fn set_ollama_endpoint(&self, endpoint: String) {
        *self.ollama_endpoint.write().await = endpoint;
    }

    /// Set the available models
    pub async fn set_models(&self, models: Vec<String>) {
        *self.models.write().await = models;
    }

    /// Register with DWS as an inference node
    async fn register_with_dws(&self) -> Result<(), String> {
        let dws_url = self.dws_url.read().await.clone();
        let wallet_address = self.wallet_address.read().await.clone();
        let ollama_endpoint = self.ollama_endpoint.read().await.clone();
        let models = self.models.read().await.clone();

        let dws_url = match dws_url {
            Some(url) => url,
            None => {
                tracing::warn!("DWS URL not configured, skipping registration");
                return Ok(());
            }
        };

        let wallet_address = match wallet_address {
            Some(addr) => addr,
            None => {
                tracing::warn!("Wallet address not configured, skipping DWS registration");
                return Ok(());
            }
        };

        let register_url = format!("{}/nodes/register", dws_url);
        tracing::info!("Registering with DWS at {}", register_url);

        let request = DWSRegisterRequest {
            address: wallet_address.clone(),
            gpu_tier: 1, // CPU-only tier
            name: Some(format!("node-{}", &wallet_address[2..10])),
            endpoint: Some(ollama_endpoint),
            capabilities: Some(vec!["inference".to_string()]),
            models: Some(models),
            provider: Some("ollama".to_string()),
            region: Some("unknown".to_string()),
            max_concurrent: Some(4),
        };

        let client = reqwest::Client::new();
        match client
            .post(&register_url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<DWSRegisterResponse>().await {
                        Ok(resp) => {
                            tracing::info!(
                                "Successfully registered with DWS: address={}, gpuTier={}",
                                resp.address,
                                resp.gpu_tier
                            );
                            Ok(())
                        }
                        Err(e) => {
                            let msg = format!("Failed to parse DWS response: {}", e);
                            tracing::error!("{}", msg);
                            *self.last_error.write().await = Some(msg.clone());
                            Err(msg)
                        }
                    }
                } else {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();
                    let msg = format!("DWS registration failed: {} - {}", status, body);
                    tracing::error!("{}", msg);
                    *self.last_error.write().await = Some(msg.clone());
                    Err(msg)
                }
            }
            Err(e) => {
                let msg = format!("Failed to connect to DWS: {}", e);
                tracing::error!("{}", msg);
                *self.last_error.write().await = Some(msg.clone());
                Err(msg)
            }
        }
    }

    /// Send heartbeat to DWS
    async fn send_heartbeat(&self) -> Result<(), String> {
        let dws_url = self.dws_url.read().await.clone();
        let wallet_address = self.wallet_address.read().await.clone();

        let dws_url = match dws_url {
            Some(url) => url,
            None => return Ok(()),
        };

        let wallet_address = match wallet_address {
            Some(addr) => addr,
            None => return Ok(()),
        };

        let heartbeat_url = format!("{}/nodes/heartbeat", dws_url);
        let request = DWSHeartbeatRequest {
            address: wallet_address,
            load: Some(self.requests_served.load(Ordering::SeqCst) as u32 % 100),
        };

        let client = reqwest::Client::new();
        match client
            .post(&heartbeat_url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    tracing::debug!("Heartbeat sent successfully");
                    Ok(())
                } else {
                    let msg = format!("Heartbeat failed: {}", response.status());
                    tracing::warn!("{}", msg);
                    Err(msg)
                }
            }
            Err(e) => {
                let msg = format!("Heartbeat error: {}", e);
                tracing::warn!("{}", msg);
                Err(msg)
            }
        }
    }
}

#[async_trait::async_trait]
impl Service for ComputeService {
    fn id(&self) -> ServiceId {
        ServiceId::Compute
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "compute".to_string(),
            name: "Compute Node".to_string(),
            description: "Provide AI inference services and GPU compute. Earn per-token fees for serving models like Llama, Mistral, and more.".to_string(),
            min_stake_eth: 0.1,
            estimated_earnings_per_hour_usd: 0.50,
            requirements: self.requirements(),
            warnings: vec![],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 1,
            min_memory_mb: 8 * 1024, // 8 GB
            min_storage_gb: 50,
            requires_gpu: false,
            min_gpu_memory_mb: None,
            requires_tee: false,
            min_bandwidth_mbps: Some(10),
        }
    }

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Service already running".to_string());
        }

        tracing::info!("Starting compute service");

        // Read configuration from custom_settings
        if let Some(dws_url) = config.custom_settings.get("dws_url") {
            if let Some(url) = dws_url.as_str() {
                tracing::info!("Setting DWS URL: {}", url);
                *self.dws_url.write().await = Some(url.to_string());
            }
        }

        if let Some(wallet_addr) = config.custom_settings.get("wallet_address") {
            if let Some(addr) = wallet_addr.as_str() {
                tracing::info!("Setting wallet address: {}", addr);
                *self.wallet_address.write().await = Some(addr.to_string());
            }
        }

        if let Some(ollama_endpoint) = config.custom_settings.get("ollama_endpoint") {
            if let Some(endpoint) = ollama_endpoint.as_str() {
                tracing::info!("Setting Ollama endpoint: {}", endpoint);
                *self.ollama_endpoint.write().await = endpoint.to_string();
            }
        }

        if let Some(models_val) = config.custom_settings.get("models") {
            if let Some(models_arr) = models_val.as_array() {
                let models: Vec<String> = models_arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                if !models.is_empty() {
                    tracing::info!("Setting models: {:?}", models);
                    *self.models.write().await = models;
                }
            }
        }

        // Create shutdown channel
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        // Mark as running
        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        // Register with DWS
        if let Err(e) = self.register_with_dws().await {
            tracing::warn!("DWS registration failed (will retry): {}", e);
            // Don't fail startup, just log the error - we'll retry in the heartbeat loop
        }

        // Clone for async task
        let running = self.running.clone();
        let requests_served = self.requests_served.clone();
        let _earnings_wei = self.earnings_wei.clone();
        let last_error = self.last_error.clone();
        let _rpc_url = self.rpc_url.clone();
        let stake_amount = config.stake_amount.clone();
        let dws_url = self.dws_url.clone();
        let wallet_address = self.wallet_address.clone();
        let ollama_endpoint = self.ollama_endpoint.clone();
        let models = self.models.clone();

        // Spawn service task with heartbeat
        tokio::spawn(async move {
            tracing::info!("Compute service started with stake: {:?}", stake_amount);

            let mut heartbeat_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            let mut retry_registration = false;

            // Main service loop
            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Compute service received shutdown signal");
                        break;
                    }
                    _ = heartbeat_interval.tick() => {
                        // Send heartbeat to DWS
                        let dws = dws_url.read().await.clone();
                        let wallet = wallet_address.read().await.clone();

                        if let (Some(dws), Some(wallet)) = (dws, wallet) {
                            let heartbeat_url = format!("{}/nodes/heartbeat", dws);
                            let request = DWSHeartbeatRequest {
                                address: wallet.clone(),
                                load: Some((requests_served.load(Ordering::SeqCst) % 100) as u32),
                            };

                            let client = reqwest::Client::new();
                            match client
                                .post(&heartbeat_url)
                                .json(&request)
                                .timeout(std::time::Duration::from_secs(5))
                                .send()
                                .await
                            {
                                Ok(response) => {
                                    if response.status().is_success() {
                                        tracing::debug!("Heartbeat sent successfully");
                                        retry_registration = false;
                                    } else {
                                        tracing::warn!("Heartbeat failed: {}, will retry registration", response.status());
                                        retry_registration = true;
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("Heartbeat error: {}, will retry registration", e);
                                    retry_registration = true;
                                    *last_error.write().await = Some(format!("Heartbeat error: {}", e));
                                }
                            }

                            // If heartbeat failed, try to re-register
                            if retry_registration {
                                tracing::info!("Attempting to re-register with DWS...");
                                let register_url = format!("{}/nodes/register", dws);
                                let endpoint = ollama_endpoint.read().await.clone();
                                let model_list = models.read().await.clone();
                                let register_request = DWSRegisterRequest {
                                    address: wallet.clone(),
                                    gpu_tier: 1,
                                    name: Some(format!("node-{}", &wallet[2..10])),
                                    endpoint: Some(endpoint),
                                    capabilities: Some(vec!["inference".to_string()]),
                                    models: Some(model_list),
                                    provider: Some("ollama".to_string()),
                                    region: Some("unknown".to_string()),
                                    max_concurrent: Some(4),
                                };

                                if let Ok(response) = client
                                    .post(&register_url)
                                    .json(&register_request)
                                    .timeout(std::time::Duration::from_secs(10))
                                    .send()
                                    .await
                                {
                                    if response.status().is_success() {
                                        tracing::info!("Re-registration successful");
                                        retry_registration = false;
                                    }
                                }
                            }
                        }

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Compute service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping compute service");

        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // Wait for shutdown
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        self.running.store(false, Ordering::SeqCst);
        *self.start_time.write().await = None;

        Ok(())
    }

    async fn status(&self) -> ServiceState {
        let uptime = self
            .start_time
            .read()
            .await
            .map(|t| t.elapsed().as_secs())
            .unwrap_or(0);

        ServiceState {
            running: self.running.load(Ordering::SeqCst),
            uptime_seconds: uptime,
            requests_served: self.requests_served.load(Ordering::SeqCst),
            earnings_wei: self.earnings_wei.read().await.clone(),
            last_error: self.last_error.read().await.clone(),
            health: if self.running.load(Ordering::SeqCst) {
                "healthy".to_string()
            } else {
                "stopped".to_string()
            },
        }
    }

    async fn health_check(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}
