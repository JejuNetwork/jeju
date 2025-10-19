use super::*;
use crate::backup::manager::BackupManager;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::Duration;
use tracing::{error, info};

pub struct BackupScheduler {
    backup_manager: Arc<tokio::sync::RwLock<BackupManager>>,
    running: Arc<Mutex<bool>>,
}

impl BackupScheduler {
    pub fn new(backup_manager: Arc<tokio::sync::RwLock<BackupManager>>) -> Self {
        Self {
            backup_manager,
            running: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn start(&self) {
        let mut running = self.running.lock().await;
        if *running {
            info!("Backup scheduler already running");
            return;
        }
        *running = true;
        drop(running);

        let backup_manager = self.backup_manager.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            info!("Backup scheduler started");

            loop {
                // Check if we should stop
                if !*running.lock().await {
                    info!("Backup scheduler stopping");
                    break;
                }

                // Get current config
                let config = backup_manager.read().await.get_config().await;

                if !config.auto_backup_enabled {
                    // Wait a bit and check again
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }

                // Wait for the configured interval
                let interval_duration =
                    Duration::from_secs(config.auto_backup_interval_hours as u64 * 3600);
                tokio::time::sleep(interval_duration).await;

                // Check again if we should stop
                if !*running.lock().await {
                    break;
                }

                // Create automatic backup
                info!("Creating scheduled automatic backup");
                match backup_manager
                    .read()
                    .await
                    .create_backup(
                        BackupType::Automatic,
                        Some("Scheduled automatic backup".to_string()),
                    )
                    .await
                {
                    Ok(backup) => {
                        info!("Automatic backup created successfully: {}", backup.id);
                    }
                    Err(e) => {
                        error!("Failed to create automatic backup: {}", e);
                    }
                }
            }
        });
    }

    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
        info!("Backup scheduler stopped");
    }

    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    pub async fn trigger_backup(&self) -> BackupResult<Backup> {
        info!("Manually triggering scheduled backup");
        self.backup_manager
            .read()
            .await
            .create_backup(
                BackupType::Automatic,
                Some("Manually triggered scheduled backup".to_string()),
            )
            .await
    }
}
