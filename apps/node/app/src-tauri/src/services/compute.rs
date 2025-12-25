//! Compute service - AI inference provider

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct ComputeService {
    rpc_url: String,
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
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            requests_served: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
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
            min_cpu_cores: 8,
            min_memory_mb: 32 * 1024, // 32 GB
            min_storage_gb: 100,
            requires_gpu: true,
            min_gpu_memory_mb: Some(8 * 1024), // 8 GB VRAM
            requires_tee: false,
            min_bandwidth_mbps: Some(100),
        }
    }

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Service already running".to_string());
        }

        tracing::info!("Starting compute service");

        // Create shutdown channel
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        // Mark as running
        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        // Clone for async task
        let running = self.running.clone();
        let _requests_served = self.requests_served.clone();
        let _earnings_wei = self.earnings_wei.clone();
        let _last_error = self.last_error.clone();
        let _rpc_url = self.rpc_url.clone();
        let stake_amount = config.stake_amount.clone();

        // Spawn service task
        tokio::spawn(async move {
            tracing::info!("Compute service started with stake: {:?}", stake_amount);

            // Main service loop
            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Compute service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {
                        // Simulate processing requests
                        // In production, this would:
                        // 1. Listen for inference requests via A2A/MCP protocol
                        // 2. Process requests through local Ollama/vLLM
                        // 3. Return results and settle payments

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
