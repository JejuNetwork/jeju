//! Proxy service - residential proxy provider

use super::{Service, ServiceId, ServiceMetadata, ServiceState};
use crate::config::ServiceConfig;
use crate::hardware::ServiceRequirements;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

pub struct ProxyService {
    rpc_url: String,
    running: Arc<AtomicBool>,
    start_time: Arc<RwLock<Option<Instant>>>,
    requests_proxied: Arc<AtomicU64>,
    bytes_transferred: Arc<AtomicU64>,
    earnings_wei: Arc<RwLock<String>>,
    last_error: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ProxyService {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            rpc_url: rpc_url.to_string(),
            running: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(RwLock::new(None)),
            requests_proxied: Arc::new(AtomicU64::new(0)),
            bytes_transferred: Arc::new(AtomicU64::new(0)),
            earnings_wei: Arc::new(RwLock::new("0".to_string())),
            last_error: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        }
    }
}

#[async_trait::async_trait]
impl Service for ProxyService {
    fn id(&self) -> ServiceId {
        ServiceId::Proxy
    }

    fn metadata(&self) -> ServiceMetadata {
        ServiceMetadata {
            id: "proxy".to_string(),
            name: "Proxy Node".to_string(),
            description: "Provide residential proxy services. Earn per-request and bandwidth fees for routing traffic.".to_string(),
            min_stake_eth: 0.1,
            estimated_earnings_per_hour_usd: 0.15,
            requirements: self.requirements(),
            warnings: vec![
                "Uses your residential IP address".to_string(),
                "Bandwidth usage may be significant".to_string(),
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
            min_bandwidth_mbps: Some(50),
        }
    }

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Service already running".to_string());
        }

        tracing::info!("Starting proxy service");

        let (tx, mut rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(tx);

        self.running.store(true, Ordering::SeqCst);
        *self.start_time.write().await = Some(Instant::now());

        let running = self.running.clone();
        let requests_proxied = self.requests_proxied.clone();
        let bytes_transferred = self.bytes_transferred.clone();
        let earnings_wei = self.earnings_wei.clone();

        tokio::spawn(async move {
            tracing::info!("Proxy service started");

            loop {
                tokio::select! {
                    _ = &mut rx => {
                        tracing::info!("Proxy service received shutdown signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {
                        // In production:
                        // 1. Connect to coordinator
                        // 2. Accept proxy requests
                        // 3. Forward traffic
                        // 4. Report metrics for payment

                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }
            }

            running.store(false, Ordering::SeqCst);
            tracing::info!("Proxy service stopped");
        });

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        tracing::info!("Stopping proxy service");

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
            requests_served: self.requests_proxied.load(Ordering::SeqCst),
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
