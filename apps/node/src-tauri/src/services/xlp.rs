//! XLP service - cross-chain liquidity provider

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct XlpService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    transfers_facilitated: Arc<AtomicU64>,
    volume_wei: Arc<RwLock<String>>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl XlpService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            transfers_facilitated: Arc::new(AtomicU64::new(0)),
            volume_wei: Arc::new(RwLock::new("0".to_string())),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for XlpService {
    fn id(&self) -> ServiceId {
        ServiceId::Xlp
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "xlp".to_string(),
            name: "XLP (Liquidity Provider)".to_string(),
            description: "Provide liquidity for fast cross-chain bridges. Earn 0.05-0.3% on every transfer you facilitate.".to_string(),
            min_stake_eth: 1.0, // 1 ETH minimum
            estimated_earnings_per_hour_usd: 0.40,
            requirements: self.requirements(),
            warnings: vec![
                "Capital will be locked in liquidity pools".to_string(),
                "14-day lockup period for withdrawals".to_string(),
            ],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 2,
            min_memory_mb: 4 * 1024, // 4 GB
            min_storage_gb: 20,
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

        tracing::info!("Starting XLP service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let transfers = self.transfers_facilitated.clone();
        let volume = self.volume_wei.clone();
        let earnings = self.earnings_wei.clone();

        tokio::spawn(async move {
            tracing::info!("XLP service started");

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("XLP service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {
                        // In production:
                        // 1. Provide liquidity to LiquidityAggregator
                        // 2. Listen for bridge requests
                        // 3. Facilitate transfers
                        // 4. Collect fees automatically
                        
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("XLP service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping XLP service");

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
            requests_served: self.transfers_facilitated.load(Ordering::SeqCst),
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

