use crate::backup::{BackupManager, BackupScheduler};
use crate::container::ContainerManager;
use crate::startup::StartupManager;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Global application state shared across all Tauri commands
pub struct GlobalAppState {
    pub container_manager: Arc<ContainerManager>,
    pub startup_manager: Arc<tokio::sync::Mutex<StartupManager>>,
    pub backup_manager: Arc<RwLock<BackupManager>>,
    pub backup_scheduler: Arc<RwLock<BackupScheduler>>,
}

impl GlobalAppState {
    pub fn new(
        container_manager: Arc<ContainerManager>,
        startup_manager: Arc<tokio::sync::Mutex<StartupManager>>,
        backup_manager: Arc<RwLock<BackupManager>>,
        backup_scheduler: Arc<RwLock<BackupScheduler>>,
    ) -> Self {
        Self {
            container_manager,
            startup_manager,
            backup_manager,
            backup_scheduler,
        }
    }
}
