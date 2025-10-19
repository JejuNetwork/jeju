use super::*;
use crate::container::manager::ContainerManager;
use chrono::Utc;
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use uuid::Uuid;

pub struct BackupManager {
    config: Arc<Mutex<BackupConfig>>,
    container_manager: Arc<ContainerManager>,
    _app_handle: AppHandle,
}

impl BackupManager {
    pub fn new(container_manager: Arc<ContainerManager>, app_handle: AppHandle) -> Self {
        let config = Arc::new(Mutex::new(BackupConfig::default()));
        Self {
            config,
            container_manager,
            _app_handle: app_handle,
        }
    }

    pub async fn create_backup(
        &self,
        backup_type: BackupType,
        notes: Option<String>,
    ) -> BackupResult<Backup> {
        info!("Creating {:?} backup", backup_type);

        let config = self.config.lock().await;
        let backup_id = Uuid::new_v4().to_string();
        let timestamp = Utc::now();
        let backup_dir = config.backup_directory.join(&backup_id);

        // Create backup directory
        fs::create_dir_all(&backup_dir).map_err(|e| BackupError::Io(e))?;

        let mut components = Vec::new();
        let mut total_size = 0u64;

        // 1. Backup PostgreSQL database
        match self.backup_postgres(&backup_dir).await {
            Ok(component) => {
                total_size += component.size_bytes;
                components.push(component);
            }
            Err(e) => {
                error!("Failed to backup PostgreSQL: {}", e);
                // Clean up and return error
                let _ = fs::remove_dir_all(&backup_dir);
                return Err(e);
            }
        }

        // 2. Backup agent state (volumes)
        match self.backup_agent_volumes(&backup_dir).await {
            Ok(volume_components) => {
                for component in volume_components {
                    total_size += component.size_bytes;
                    components.push(component);
                }
            }
            Err(e) => {
                error!("Failed to backup agent volumes: {}", e);
                // Clean up and return error
                let _ = fs::remove_dir_all(&backup_dir);
                return Err(e);
            }
        }

        // Get metadata
        let metadata = self.get_backup_metadata(notes).await?;

        // Create backup manifest
        let backup = Backup {
            id: backup_id.clone(),
            timestamp,
            backup_type,
            size_bytes: total_size,
            components,
            metadata,
        };

        // Save manifest
        let manifest_path = backup_dir.join("manifest.json");
        let manifest_json = serde_json::to_string_pretty(&backup)
            .map_err(|e| BackupError::Config(e.to_string()))?;
        fs::write(&manifest_path, manifest_json)?;

        // Clean up old backups if needed
        if backup_type == BackupType::Automatic {
            self.cleanup_old_backups(&config).await?;
        }

        info!("Backup {} created successfully", backup_id);
        Ok(backup)
    }

    async fn run_command(&self, cmd: Vec<&str>) -> BackupResult<std::process::Output> {
        let mut command = Command::new(cmd[0]);
        command.args(&cmd[1..]);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let output = command
            .output()
            .await
            .map_err(|e| BackupError::Container(format!("Command failed: {}", e)))?;

        Ok(output)
    }

    async fn backup_postgres(&self, backup_dir: &Path) -> BackupResult<BackupComponent> {
        info!("Backing up PostgreSQL database");

        let output_file = backup_dir.join("postgres.sql.gz");
        let container_name = "eliza-postgres";

        // Run pg_dump inside the container
        let dump_cmd = vec![
            "podman",
            "exec",
            container_name,
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "eliza",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
        ];

        let dump_output = self.run_command(dump_cmd).await?;

        if !dump_output.status.success() {
            let stderr = String::from_utf8_lossy(&dump_output.stderr);
            return Err(BackupError::DatabaseBackup(format!(
                "pg_dump failed: {}",
                stderr
            )));
        }

        // Compress the dump
        let file = File::create(&output_file)?;
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder.write_all(&dump_output.stdout)?;
        encoder.finish()?;

        // Calculate checksum
        let checksum = self.calculate_checksum(&output_file)?;
        let size = fs::metadata(&output_file)?.len();

        Ok(BackupComponent {
            name: "PostgreSQL Database".to_string(),
            component_type: ComponentType::PostgresDatabase,
            path: output_file,
            size_bytes: size,
            checksum,
        })
    }

    async fn backup_agent_volumes(&self, backup_dir: &Path) -> BackupResult<Vec<BackupComponent>> {
        info!("Backing up agent volumes");

        let volumes = vec![
            ("eliza-agent-data", ComponentType::AgentState),
            ("eliza-agent-knowledge", ComponentType::AgentKnowledge),
            ("eliza-agent-logs", ComponentType::AgentLogs),
        ];

        let mut components = Vec::new();

        for (volume_name, component_type) in volumes {
            match self
                .backup_volume(volume_name, component_type, backup_dir)
                .await
            {
                Ok(component) => components.push(component),
                Err(e) => {
                    warn!("Failed to backup volume {}: {}", volume_name, e);
                    // Continue with other volumes
                }
            }
        }

        Ok(components)
    }

    async fn backup_volume(
        &self,
        volume_name: &str,
        component_type: ComponentType,
        backup_dir: &Path,
    ) -> BackupResult<BackupComponent> {
        let output_file = backup_dir.join(format!("{}.tar.gz", volume_name));

        // Create a temporary container to access the volume
        let temp_container = format!("backup-temp-{}", Uuid::new_v4());

        // Run a container with the volume mounted
        let volume_mount = format!("{}:/backup-source:ro", volume_name);
        let create_cmd = vec![
            "podman",
            "create",
            "--name",
            &temp_container,
            "-v",
            &volume_mount,
            "alpine:latest",
            "tar",
            "-czf",
            "/backup.tar.gz",
            "-C",
            "/backup-source",
            ".",
        ];

        let output = self.run_command(create_cmd).await?;

        if !output.status.success() {
            return Err(BackupError::AgentStateBackup(format!(
                "Failed to create backup container"
            )));
        }

        // Start the container
        let start_cmd = vec!["podman", "start", "-a", &temp_container];
        let output = self.run_command(start_cmd).await?;

        if !output.status.success() {
            // Clean up
            let _ = self
                .run_command(vec!["podman", "rm", "-f", &temp_container])
                .await;
            return Err(BackupError::AgentStateBackup(format!(
                "Failed to create volume backup"
            )));
        }

        // Copy the backup file out
        let source_path = format!("{}:/backup.tar.gz", temp_container);
        let copy_cmd = vec!["podman", "cp", &source_path, output_file.to_str().unwrap()];

        let output = self.run_command(copy_cmd).await?;

        // Clean up the temporary container
        let _ = self
            .run_command(vec!["podman", "rm", "-f", &temp_container])
            .await;

        if !output.status.success() {
            return Err(BackupError::AgentStateBackup(format!(
                "Failed to copy backup file"
            )));
        }

        // Calculate checksum
        let checksum = self.calculate_checksum(&output_file)?;
        let size = fs::metadata(&output_file)?.len();

        Ok(BackupComponent {
            name: format!("{:?}", component_type),
            component_type,
            path: output_file,
            size_bytes: size,
            checksum,
        })
    }

    pub async fn restore_backup(
        &self,
        backup_id: &str,
        options: RestoreOptions,
    ) -> BackupResult<()> {
        info!("Restoring backup {}", backup_id);

        let config = self.config.lock().await;
        let backup_dir = config.backup_directory.join(backup_id);

        if !backup_dir.exists() {
            return Err(BackupError::NotFound(backup_id.to_string()));
        }

        // Load manifest
        let manifest_path = backup_dir.join("manifest.json");
        let manifest_data = fs::read_to_string(&manifest_path)?;
        let backup: Backup = serde_json::from_str(&manifest_data)
            .map_err(|e| BackupError::InvalidBackup(e.to_string()))?;

        // Verify checksums
        for component in &backup.components {
            let calculated = self.calculate_checksum(&component.path)?;
            if calculated != component.checksum {
                return Err(BackupError::InvalidBackup(format!(
                    "Checksum mismatch for component: {}",
                    component.name
                )));
            }
        }

        // Stop containers before restore
        info!("Stopping containers for restore");
        let _ = self.container_manager.stop_containers().await;

        // Restore components
        for component in &backup.components {
            match component.component_type {
                ComponentType::PostgresDatabase if options.restore_database => {
                    self.restore_postgres(&component.path).await?;
                }
                ComponentType::AgentState if options.restore_agent_state => {
                    self.restore_volume("eliza-agent-data", &component.path)
                        .await?;
                }
                ComponentType::AgentKnowledge if options.restore_knowledge => {
                    self.restore_volume("eliza-agent-knowledge", &component.path)
                        .await?;
                }
                ComponentType::AgentLogs if options.restore_logs => {
                    self.restore_volume("eliza-agent-logs", &component.path)
                        .await?;
                }
                _ => {
                    info!("Skipping component: {}", component.name);
                }
            }
        }

        // Restart containers
        info!("Restarting containers after restore");
        // Start containers individually as there's no start_all method
        let _ = self
            .run_command(vec!["podman", "start", "eliza-postgres"])
            .await;
        let _ = self
            .run_command(vec!["podman", "start", "eliza-ollama"])
            .await;
        let _ = self
            .run_command(vec!["podman", "start", "eliza-agent"])
            .await;

        info!("Restore completed successfully");
        Ok(())
    }

    async fn restore_postgres(&self, backup_file: &Path) -> BackupResult<()> {
        info!("Restoring PostgreSQL database");

        // Start postgres if not running
        let _ = self
            .run_command(vec!["podman", "start", "eliza-postgres"])
            .await;

        // Wait for postgres to be ready
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        // Decompress and restore
        let cmd_string = if cfg!(windows) {
            format!(
                "Get-Content '{}' | gunzip | docker exec -i eliza-postgres psql -U postgres -d eliza",
                backup_file.display()
            )
        } else {
            format!(
                "gunzip -c '{}' | podman exec -i eliza-postgres psql -U postgres -d eliza",
                backup_file.display()
            )
        };

        let decompress_cmd = if cfg!(windows) {
            vec!["powershell", "-Command", &cmd_string]
        } else {
            vec!["sh", "-c", &cmd_string]
        };

        let output = self
            .run_command(decompress_cmd)
            .await
            .map_err(|e| BackupError::RestoreFailed(format!("Database restore failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(BackupError::RestoreFailed(format!(
                "psql failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    async fn restore_volume(&self, volume_name: &str, backup_file: &Path) -> BackupResult<()> {
        info!("Restoring volume {}", volume_name);

        // Create a temporary container to restore the volume
        let _temp_container = format!("restore-temp-{}", Uuid::new_v4());

        // Clear the volume first
        let volume_mount_clear = format!("{}:/data", volume_name);
        let clear_cmd = vec![
            "podman",
            "run",
            "--rm",
            "-v",
            &volume_mount_clear,
            "alpine:latest",
            "sh",
            "-c",
            "rm -rf /data/*",
        ];

        let _ = self.run_command(clear_cmd).await;

        // Restore the backup
        let volume_mount_restore = format!("{}:/data", volume_name);
        let backup_mount = format!("{}:/backup.tar.gz:ro", backup_file.display());
        let restore_cmd = vec![
            "podman",
            "run",
            "--rm",
            "-v",
            &volume_mount_restore,
            "-v",
            &backup_mount,
            "alpine:latest",
            "tar",
            "-xzf",
            "/backup.tar.gz",
            "-C",
            "/data",
        ];

        let output = self
            .run_command(restore_cmd)
            .await
            .map_err(|e| BackupError::RestoreFailed(format!("Volume restore failed: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(BackupError::RestoreFailed(format!(
                "tar failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    pub async fn list_backups(&self) -> BackupResult<Vec<Backup>> {
        let config = self.config.lock().await;
        let backup_dir = &config.backup_directory;

        if !backup_dir.exists() {
            return Ok(Vec::new());
        }

        let mut backups = Vec::new();

        let entries = fs::read_dir(backup_dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    match fs::read_to_string(&manifest_path) {
                        Ok(data) => match serde_json::from_str::<Backup>(&data) {
                            Ok(backup) => backups.push(backup),
                            Err(e) => warn!("Invalid manifest in {:?}: {}", path, e),
                        },
                        Err(e) => warn!("Failed to read manifest in {:?}: {}", path, e),
                    }
                }
            }
        }

        // Sort by timestamp, newest first
        backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        Ok(backups)
    }

    pub async fn delete_backup(&self, backup_id: &str) -> BackupResult<()> {
        let config = self.config.lock().await;
        let backup_dir = config.backup_directory.join(backup_id);

        if !backup_dir.exists() {
            return Err(BackupError::NotFound(backup_id.to_string()));
        }

        fs::remove_dir_all(&backup_dir)?;
        info!("Deleted backup {}", backup_id);

        Ok(())
    }

    pub async fn update_config(&self, new_config: BackupConfig) -> BackupResult<()> {
        let mut config = self.config.lock().await;

        // Create backup directory if it doesn't exist
        fs::create_dir_all(&new_config.backup_directory)?;

        *config = new_config;
        Ok(())
    }

    pub async fn get_config(&self) -> BackupConfig {
        self.config.lock().await.clone()
    }

    async fn cleanup_old_backups(&self, config: &BackupConfig) -> BackupResult<()> {
        let mut backups = self.list_backups().await?;

        // Filter automatic backups only
        backups.retain(|b| b.backup_type == BackupType::Automatic);

        // Keep only the configured number of backups
        if backups.len() > config.max_backups_to_keep as usize {
            let to_delete = backups.split_off(config.max_backups_to_keep as usize);

            for backup in to_delete {
                if let Err(e) = self.delete_backup(&backup.id).await {
                    warn!("Failed to delete old backup {}: {}", backup.id, e);
                }
            }
        }

        Ok(())
    }

    async fn get_backup_metadata(&self, notes: Option<String>) -> BackupResult<BackupMetadata> {
        // Get agent info from the container
        let agent_info_cmd = vec!["podman", "exec", "eliza-agent", "cat", "/app/agent.json"];

        let output = self.run_command(agent_info_cmd).await?;

        let (agent_id, agent_name) = if output.status.success() {
            match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                Ok(json) => (
                    json["id"].as_str().unwrap_or("unknown").to_string(),
                    json["name"].as_str().unwrap_or("ElizaOS Agent").to_string(),
                ),
                Err(_) => ("unknown".to_string(), "ElizaOS Agent".to_string()),
            }
        } else {
            ("unknown".to_string(), "ElizaOS Agent".to_string())
        };

        Ok(BackupMetadata {
            agent_id,
            agent_name,
            eliza_version: env!("CARGO_PKG_VERSION").to_string(),
            backup_version: "1.0.0".to_string(),
            notes,
        })
    }

    fn calculate_checksum(&self, file_path: &Path) -> BackupResult<String> {
        let mut file = File::open(file_path)?;
        let mut hasher = Sha256::new();
        std::io::copy(&mut file, &mut hasher)?;
        Ok(format!("{:x}", hasher.finalize()))
    }

    pub async fn create_shutdown_backup(&self) -> BackupResult<()> {
        info!("Creating shutdown backup");

        match self
            .create_backup(
                BackupType::Shutdown,
                Some("Automatic shutdown backup".to_string()),
            )
            .await
        {
            Ok(backup) => {
                info!("Shutdown backup created: {}", backup.id);
                Ok(())
            }
            Err(e) => {
                error!("Failed to create shutdown backup: {}", e);
                Err(e)
            }
        }
    }
}
