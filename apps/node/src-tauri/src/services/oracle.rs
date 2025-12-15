//! Oracle service - price feed provider

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct OracleService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    reports_submitted: Arc<AtomicU64>,
    reports_accepted: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl OracleService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            reports_submitted: Arc::new(AtomicU64::new(0)),
            reports_accepted: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for OracleService {
    fn id(&self) -> ServiceId {
        ServiceId::Oracle
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "oracle".to_string(),
            name: "Oracle Node".to_string(),
            description: "Provide price feeds and data to the network. Earn rewards for accurate, timely price reports. Requires reliable uptime.".to_string(),
            min_stake_eth: 0.3, // ~$1000 USD in staking tokens
            estimated_earnings_per_hour_usd: 0.20,
            requirements: self.requirements(),
            warnings: vec![
                "Accuracy is critical - deviation >1% from consensus results in slashing".to_string(),
                "High uptime required - downtime affects reputation score".to_string(),
            ],
            is_advanced: false,
        }
    }

    fn requirements(&self) -> ServiceRequirements {
        ServiceRequirements {
            min_cpu_cores: 2,
            min_memory_mb: 4 * 1024, // 4 GB
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

        tracing::info!("Starting oracle service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let reports_submitted = self.reports_submitted.clone();
        let reports_accepted = self.reports_accepted.clone();
        let earnings_wei = self.earnings_wei.clone();
        let rpc_url = self.rpc_url.clone();

        tokio::spawn(async move {
            tracing::info!("Oracle service started");

            // Poll interval (typically 60 seconds for price feeds)
            let poll_interval = tokio::time::Duration::from_secs(60);

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Oracle service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(poll_interval) => {
                        // In production:
                        // 1. Fetch prices from multiple sources
                        // 2. Compute median/TWAP
                        // 3. Sign and submit to ReportVerifier
                        // 4. Track acceptance and rewards
                        
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                        
                        // Increment reports (simulated)
                        reports_submitted.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Oracle service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping oracle service");

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
            requests_served: self.reports_submitted.load(Ordering::SeqCst),
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

