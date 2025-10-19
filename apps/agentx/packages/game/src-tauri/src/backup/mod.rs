use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub mod manager;
pub mod scheduler;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backup {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub backup_type: BackupType,
    pub size_bytes: u64,
    pub components: Vec<BackupComponent>,
    pub metadata: BackupMetadata,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BackupType {
    Manual,
    Automatic,
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupComponent {
    pub name: String,
    pub component_type: ComponentType,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentType {
    PostgresDatabase,
    AgentState,
    AgentKnowledge,
    AgentLogs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub agent_id: String,
    pub agent_name: String,
    pub eliza_version: String,
    pub backup_version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub auto_backup_enabled: bool,
    pub auto_backup_interval_hours: u32,
    pub max_backups_to_keep: u32,
    pub backup_directory: PathBuf,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            auto_backup_enabled: true,
            auto_backup_interval_hours: 4,
            max_backups_to_keep: 5,
            backup_directory: dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("eliza")
                .join("backups"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreOptions {
    pub restore_database: bool,
    pub restore_agent_state: bool,
    pub restore_knowledge: bool,
    pub restore_logs: bool,
    pub force: bool,
}

impl Default for RestoreOptions {
    fn default() -> Self {
        Self {
            restore_database: true,
            restore_agent_state: true,
            restore_knowledge: true,
            restore_logs: false,
            force: false,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Container error: {0}")]
    Container(String),

    #[error("Database backup failed: {0}")]
    DatabaseBackup(String),

    #[error("Agent state backup failed: {0}")]
    AgentStateBackup(String),

    #[error("Restore failed: {0}")]
    RestoreFailed(String),

    #[error("Invalid backup: {0}")]
    InvalidBackup(String),

    #[error("Backup not found: {0}")]
    NotFound(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

pub type BackupResult<T> = Result<T, BackupError>;

// Re-export commonly used types
pub use manager::BackupManager;
pub use scheduler::BackupScheduler;
