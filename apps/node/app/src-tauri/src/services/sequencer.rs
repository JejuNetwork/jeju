//! Sequencer service - block producer

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct SequencerService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    blocks_proposed: Arc<AtomicU64>,
    blocks_missed: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl SequencerService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            blocks_proposed: Arc::new(AtomicU64::new(0)),
            blocks_missed: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for SequencerService {
    fn id(&self) -> ServiceId {
        ServiceId::Sequencer
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "sequencer".to_string(),
            name: "Sequencer".to_string(),
            description: "Produce blocks for the Jeju network. Earn L2 gas fees proportional to blocks produced.".to_string(),
            min_stake_eth: 0.3, // ~1000 JEJU tokens
            estimated_earnings_per_hour_usd: 0.50,
            requirements: self.requirements(),
            warnings: vec![
                "⚠️ CRITICAL: This is a high-responsibility role".to_string(),
                "⚠️ Double-signing results in 10% stake slash + permanent ban".to_string(),
                "⚠️ Censorship results in 5% stake slash".to_string(),
                "⚠️ Downtime (100+ blocks) results in 1% stake slash".to_string(),
                "⚠️ Requires a DEDICATED machine - cannot be turned off".to_string(),
                "⚠️ 7-day unbonding period for withdrawals".to_string(),
                "Requires running full execution client (Geth/Reth/Nethermind)".to_string(),
            ],
            is_advanced: true,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 8,
            min_memory_mb: 32 * 1024, // 32 GB
            min_storage_gb: 2000,     // 2 TB for full chain data
            requires_gpu: false,
            min_gpu_memory_mb: None,
            requires_tee: false,
            min_bandwidth_mbps: Some(1000), // 1 Gbps
        }
    }

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Service already running".to_string());
        }

        // Validate stake amount
        let stake = config
            .stake_amount
            .as_ref()
            .ok_or("Stake amount required for sequencer")?;

        let stake_wei: u128 = stake.parse().map_err(|_| "Invalid stake amount")?;

        // Minimum 1000 JEJU (assuming 18 decimals)
        let min_stake = 1000u128 * 10u128.pow(18);
        if stake_wei < min_stake {
            return Err(format!(
                "Insufficient stake: {} wei, minimum {} wei (1000 JEJU)",
                stake_wei, min_stake
            ));
        }

        tracing::info!("Starting sequencer service with stake: {}", stake);

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let _blocks_proposed = self.blocks_proposed.clone();
        let _blocks_missed = self.blocks_missed.clone();
        let _earnings = self.earnings_wei.clone();
        let _last_error = self.last_error.clone();
        let _rpc_url = self.rpc_url.clone();

        tokio::spawn(async move {
            tracing::info!("Sequencer service started");

            // Heartbeat interval
            let heartbeat_interval = tokio::time::Duration::from_secs(60);

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Sequencer service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(heartbeat_interval) => {
                        // In production:
                        // 1. Run Geth/Reth/Nethermind with sequencer mode
                        // 2. Register with SequencerRegistry
                        // 3. Participate in block production rotation
                        // 4. Sign batches for threshold submission
                        // 5. Send heartbeats

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }

                        tracing::debug!("Sequencer heartbeat");
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Sequencer service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::warn!("Stopping sequencer service - this may result in missed blocks");

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
            requests_served: self.blocks_proposed.load(Ordering::SeqCst),
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
