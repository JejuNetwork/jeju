//! Solver service - intent solver

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct SolverService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    intents_filled: Arc<AtomicU64>,
    volume_wei: Arc<RwLock<String>>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl SolverService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            intents_filled: Arc::new(AtomicU64::new(0)),
            volume_wei: Arc::new(RwLock::new("0".to_string())),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for SolverService {
    fn id(&self) -> ServiceId {
        ServiceId::Solver
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "solver".to_string(),
            name: "Intent Solver".to_string(),
            description: "Fill cross-chain intents and OIF orders. Compete on speed and price to earn spreads (typically 0.1-0.5%).".to_string(),
            min_stake_eth: 0.5,
            estimated_earnings_per_hour_usd: 0.30,
            requirements: self.requirements(),
            warnings: vec![
                "Requires capital for filling intents".to_string(),
                "Speed is critical - consider fast hardware".to_string(),
            ],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 4,
            min_memory_mb: 8 * 1024, // 8 GB
            min_storage_gb: 50,
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

        tracing::info!("Starting solver service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let intents = self.intents_filled.clone();
        let volume = self.volume_wei.clone();
        let earnings = self.earnings_wei.clone();

        tokio::spawn(async move {
            tracing::info!("Solver service started");

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Solver service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
                        // In production:
                        // 1. Listen for intents from InputSettler
                        // 2. Quote best execution path
                        // 3. Fill intents atomically
                        // 4. Settle via OutputSettler

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Solver service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping solver service");

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
            requests_served: self.intents_filled.load(Ordering::SeqCst),
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
