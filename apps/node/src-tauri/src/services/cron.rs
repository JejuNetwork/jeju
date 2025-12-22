//! Cron service - trigger executor

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct CronService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    triggers_executed: Arc<AtomicU64>,
    successful_executions: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl CronService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            triggers_executed: Arc::new(AtomicU64::new(0)),
            successful_executions: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for CronService {
    fn id(&self) -> ServiceId {
        ServiceId::Cron
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "cron".to_string(),
            name: "Cron Executor".to_string(),
            description: "Execute scheduled triggers for apps on the network. Earn 10% of each trigger's execution fee.".to_string(),
            min_stake_eth: 0.0, // No stake required
            estimated_earnings_per_hour_usd: 0.05,
            requirements: self.requirements(),
            warnings: vec![],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 2,
            min_memory_mb: 2 * 1024, // 2 GB
            min_storage_gb: 10,
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

        tracing::info!("Starting cron service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let triggers_executed = self.triggers_executed.clone();
        let successful_executions = self.successful_executions.clone();
        let earnings_wei = self.earnings_wei.clone();
        let rpc_url = self.rpc_url.clone();

        tokio::spawn(async move {
            tracing::info!("Cron service started");

            // Check interval for pending triggers
            let check_interval = tokio::time::Duration::from_secs(10);

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Cron service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(check_interval) => {
                        // In production:
                        // 1. Query TriggerRegistry for due cron triggers
                        // 2. Execute trigger endpoints
                        // 3. Record execution on-chain
                        // 4. Collect executor fee

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Cron service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping cron service");

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
            requests_served: self.triggers_executed.load(Ordering::SeqCst),
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
