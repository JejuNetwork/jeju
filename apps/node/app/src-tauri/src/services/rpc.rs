//! RPC service - decentralized RPC provider

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct RpcService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    requests_served: Arc<AtomicU64>,
    blocks_synced: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl RpcService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            requests_served: Arc::new(AtomicU64::new(0)),
            blocks_synced: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for RpcService {
    fn id(&self) -> ServiceId {
        ServiceId::Rpc
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "rpc".to_string(),
            name: "RPC Node".to_string(),
            description: "Join the decentralized RPC pool and serve blockchain queries. Earn block rewards and tips based on uptime and performance.".to_string(),
            min_stake_eth: 0.3, // ~1000 JEJU
            estimated_earnings_per_hour_usd: 0.25,
            requirements: self.requirements(),
            warnings: vec![
                "Requires syncing full blockchain (may take hours initially)".to_string(),
                "Continuous uptime expected for maximum rewards".to_string(),
            ],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 8,
            min_memory_mb: 16 * 1024, // 16 GB
            min_storage_gb: 500,      // 500 GB for chain data
            requires_gpu: false,
            min_gpu_memory_mb: None,
            requires_tee: false,
            min_bandwidth_mbps: Some(100),
        }
    }

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Service already running".to_string());
        }

        tracing::info!("Starting RPC service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let requests_served = self.requests_served.clone();
        let blocks_synced = self.blocks_synced.clone();
        let earnings_wei = self.earnings_wei.clone();

        tokio::spawn(async move {
            tracing::info!("RPC service started");

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("RPC service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {
                        // In production:
                        // 1. Run Geth/Reth/Nethermind client
                        // 2. Register with NodeStakingManager
                        // 3. Serve RPC requests
                        // 4. Report metrics for rewards

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("RPC service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping RPC service");

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

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
