//! Service management - all node services

mod compute;
mod cron;
mod oracle;
mod proxy;
mod rpc;
mod sequencer;
mod solver;
mod storage;
mod xlp;

pub use compute::ComputeService;
pub use cron::CronService;
pub use oracle::OracleService;
pub use proxy::ProxyService;
pub use rpc::RpcService;
pub use sequencer::SequencerService;
pub use solver::SolverService;
pub use storage::StorageService;
pub use xlp::XlpService;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;

use crate::config::{NodeConfig, ServiceConfig};
use crate::hardware::{HardwareInfo, ServiceRequirements};

/// Service identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceId {
    Compute,
    Storage,
    Oracle,
    Proxy,
    Cron,
    Rpc,
    Xlp,
    Solver,
    Sequencer,
}

impl ServiceId {
    pub fn all() -> Vec<ServiceId> {
        vec![
            ServiceId::Compute,
            ServiceId::Storage,
            ServiceId::Oracle,
            ServiceId::Proxy,
            ServiceId::Cron,
            ServiceId::Rpc,
            ServiceId::Xlp,
            ServiceId::Solver,
            ServiceId::Sequencer,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ServiceId::Compute => "compute",
            ServiceId::Storage => "storage",
            ServiceId::Oracle => "oracle",
            ServiceId::Proxy => "proxy",
            ServiceId::Cron => "cron",
            ServiceId::Rpc => "rpc",
            ServiceId::Xlp => "xlp",
            ServiceId::Solver => "solver",
            ServiceId::Sequencer => "sequencer",
        }
    }
}

impl std::str::FromStr for ServiceId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "compute" => Ok(ServiceId::Compute),
            "storage" => Ok(ServiceId::Storage),
            "oracle" => Ok(ServiceId::Oracle),
            "proxy" => Ok(ServiceId::Proxy),
            "cron" => Ok(ServiceId::Cron),
            "rpc" => Ok(ServiceId::Rpc),
            "xlp" => Ok(ServiceId::Xlp),
            "solver" => Ok(ServiceId::Solver),
            "sequencer" => Ok(ServiceId::Sequencer),
            _ => Err(format!("Unknown service: {}", s)),
        }
    }
}

/// Service metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub min_stake_eth: f64,
    pub estimated_earnings_per_hour_usd: f64,
    pub requirements: ServiceRequirements,
    pub warnings: Vec<String>,
    pub is_advanced: bool,
}

/// Service state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceState {
    pub running: bool,
    pub uptime_seconds: u64,
    pub requests_served: u64,
    pub earnings_wei: String,
    pub last_error: Option<String>,
    pub health: String,
}

/// Service trait
#[async_trait::async_trait]
pub trait Service: Send + Sync {
    fn id(&self) -> ServiceId;
    fn metadata(&self) -> ServiceMetadata;
    fn requirements(&self) -> ServiceRequirements;

    async fn start(&mut self, config: &ServiceConfig) -> Result<(), String>;
    async fn stop(&mut self) -> Result<(), String>;
    async fn status(&self) -> ServiceState;
    async fn health_check(&self) -> bool;
}

/// Service manager coordinates all services
pub struct ServiceManager {
    services: HashMap<ServiceId, Box<dyn Service>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl ServiceManager {
    pub fn new() -> Self {
        Self {
            services: HashMap::new(),
            shutdown_tx: None,
        }
    }

    pub fn initialize(&mut self, config: &NodeConfig) -> Result<(), Box<dyn std::error::Error>> {
        // Initialize all services
        self.services.insert(
            ServiceId::Compute,
            Box::new(ComputeService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Storage,
            Box::new(StorageService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Oracle,
            Box::new(OracleService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Proxy,
            Box::new(ProxyService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Cron,
            Box::new(CronService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Rpc,
            Box::new(RpcService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Xlp,
            Box::new(XlpService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Solver,
            Box::new(SolverService::new(&config.network.rpc_url)),
        );
        self.services.insert(
            ServiceId::Sequencer,
            Box::new(SequencerService::new(&config.network.rpc_url)),
        );

        Ok(())
    }

    pub fn get_available_services(&self, hardware: &HardwareInfo) -> Vec<ServiceMetadata> {
        self.services
            .values()
            .map(|s| {
                let mut metadata = s.metadata();
                let reqs = s.requirements();

                // Check if hardware meets requirements
                let detector = crate::hardware::HardwareDetector::new();
                let (meets, issues) = detector.meets_requirements(hardware, &reqs);

                if !meets {
                    metadata.warnings.extend(issues);
                }

                metadata
            })
            .collect()
    }

    pub async fn start_service(
        &mut self,
        id: ServiceId,
        config: &ServiceConfig,
    ) -> Result<(), String> {
        let service = self.services.get_mut(&id).ok_or("Service not found")?;
        service.start(config).await
    }

    pub async fn stop_service(&mut self, id: ServiceId) -> Result<(), String> {
        let service = self.services.get_mut(&id).ok_or("Service not found")?;
        service.stop().await
    }

    pub async fn get_service_status(&self, id: ServiceId) -> Result<ServiceState, String> {
        let service = self.services.get(&id).ok_or("Service not found")?;
        Ok(service.status().await)
    }

    pub async fn get_all_status(&self) -> HashMap<String, ServiceState> {
        let mut statuses = HashMap::new();
        for (id, service) in &self.services {
            statuses.insert(id.as_str().to_string(), service.status().await);
        }
        statuses
    }

    pub async fn shutdown_all(&mut self) {
        for (id, service) in &mut self.services {
            if let Err(e) = service.stop().await {
                tracing::error!("Failed to stop service {:?}: {}", id, e);
            }
        }
    }
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self::new()
    }
}
