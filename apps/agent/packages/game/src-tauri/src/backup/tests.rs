#[cfg(test)]
mod tests {
    use super::super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[allow(dead_code)]
    fn create_test_backup_config() -> BackupConfig {
        let temp_dir = TempDir::new().unwrap();
        BackupConfig {
            auto_backup_enabled: true,
            auto_backup_interval_hours: 4,
            max_backups_to_keep: 5,
            backup_directory: temp_dir.path().to_path_buf(),
        }
    }

    #[test]
    fn test_backup_types() {
        assert_eq!(
            serde_json::to_string(&BackupType::Manual).unwrap(),
            "\"manual\""
        );
        assert_eq!(
            serde_json::to_string(&BackupType::Automatic).unwrap(),
            "\"automatic\""
        );
        assert_eq!(
            serde_json::to_string(&BackupType::Shutdown).unwrap(),
            "\"shutdown\""
        );
    }

    #[test]
    fn test_backup_config_default() {
        let config = BackupConfig::default();
        assert_eq!(config.auto_backup_enabled, true);
        assert_eq!(config.auto_backup_interval_hours, 4);
        assert_eq!(config.max_backups_to_keep, 5);
        assert!(config.backup_directory.ends_with("eliza/backups"));
    }

    #[test]
    fn test_restore_options_default() {
        let options = RestoreOptions::default();
        assert_eq!(options.restore_database, true);
        assert_eq!(options.restore_agent_state, true);
        assert_eq!(options.restore_knowledge, true);
        assert_eq!(options.restore_logs, false);
        assert_eq!(options.force, false);
    }

    #[test]
    fn test_backup_serialization() {
        use chrono::Utc;

        let backup = Backup {
            id: "test-123".to_string(),
            timestamp: Utc::now(),
            backup_type: BackupType::Manual,
            size_bytes: 1024,
            components: vec![BackupComponent {
                name: "test component".to_string(),
                component_type: ComponentType::PostgresDatabase,
                path: PathBuf::from("/test/path"),
                size_bytes: 512,
                checksum: "abc123".to_string(),
            }],
            metadata: BackupMetadata {
                agent_id: "agent-123".to_string(),
                agent_name: "Test Agent".to_string(),
                eliza_version: "1.0.0".to_string(),
                backup_version: "1.0.0".to_string(),
                notes: Some("Test backup".to_string()),
            },
        };

        let json = serde_json::to_string(&backup).unwrap();
        let deserialized: Backup = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, backup.id);
        assert_eq!(deserialized.backup_type, backup.backup_type);
        assert_eq!(deserialized.size_bytes, backup.size_bytes);
        assert_eq!(deserialized.components.len(), 1);
        assert_eq!(deserialized.metadata.agent_name, "Test Agent");
    }

    // Comment out tests requiring tauri app handle for now
    // These tests need to be run with the test feature enabled
    /*
    #[tokio::test]
    async fn test_backup_manager_initialization() {
        let container_manager = Arc::new(
            ContainerManager::new_with_runtime_type(
                crate::backend::ContainerRuntimeType::Podman
            ).unwrap()
        );

        // Create a mock app handle
        let app_handle = tauri::test::mock_app().handle();

        let backup_manager = BackupManager::new(container_manager, app_handle);
        let config = backup_manager.get_config().await;

        assert_eq!(config.auto_backup_enabled, true);
        assert_eq!(config.auto_backup_interval_hours, 4);
    }
    */

    /*
    #[tokio::test]
    async fn test_list_backups_empty() {
        let container_manager = Arc::new(
            ContainerManager::new_with_runtime_type(
                crate::backend::ContainerRuntimeType::Podman
            ).unwrap()
        );

        let app_handle = tauri::test::mock_app().handle();
        let backup_manager = BackupManager::new(container_manager, app_handle);

        // Update config to use temp directory
        let temp_config = create_test_backup_config();
        backup_manager.update_config(temp_config).await.unwrap();

        let backups = backup_manager.list_backups().await.unwrap();
        assert_eq!(backups.len(), 0);
    }
    */

    #[test]
    fn test_backup_error_display() {
        let io_error = BackupError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "File not found",
        ));
        assert!(io_error.to_string().contains("IO error"));

        let container_error = BackupError::Container("Container not running".to_string());
        assert_eq!(
            container_error.to_string(),
            "Container error: Container not running"
        );

        let db_error = BackupError::DatabaseBackup("pg_dump failed".to_string());
        assert_eq!(
            db_error.to_string(),
            "Database backup failed: pg_dump failed"
        );
    }

    /*
    #[tokio::test]
    async fn test_backup_scheduler() {
        let container_manager = Arc::new(
            ContainerManager::new_with_runtime_type(
                crate::backend::ContainerRuntimeType::Podman
            ).unwrap()
        );

        let app_handle = tauri::test::mock_app().handle();
        let backup_manager = Arc::new(
            BackupManager::new(container_manager, app_handle)
        );

        let scheduler = BackupScheduler::new(backup_manager);

        assert!(!scheduler.is_running().await);

        scheduler.start().await;
        assert!(scheduler.is_running().await);

        scheduler.stop().await;
        assert!(!scheduler.is_running().await);
    }
    */

    #[test]
    fn test_component_type_serialization() {
        let cases = vec![
            (ComponentType::PostgresDatabase, "\"postgres_database\""),
            (ComponentType::AgentState, "\"agent_state\""),
            (ComponentType::AgentKnowledge, "\"agent_knowledge\""),
            (ComponentType::AgentLogs, "\"agent_logs\""),
        ];

        for (component_type, expected) in cases {
            assert_eq!(serde_json::to_string(&component_type).unwrap(), expected);
        }
    }

    /*
    #[tokio::test]
    async fn test_update_config() {
        let container_manager = Arc::new(
            ContainerManager::new_with_runtime_type(
                crate::backend::ContainerRuntimeType::Podman
            ).unwrap()
        );

        let app_handle = tauri::test::mock_app().handle();
        let backup_manager = BackupManager::new(container_manager, app_handle);

        let new_config = BackupConfig {
            auto_backup_enabled: false,
            auto_backup_interval_hours: 8,
            max_backups_to_keep: 10,
            backup_directory: PathBuf::from("/custom/backup/path"),
        };

        backup_manager.update_config(new_config.clone()).await.unwrap();
        let retrieved_config = backup_manager.get_config().await;

        assert_eq!(retrieved_config.auto_backup_enabled, false);
        assert_eq!(retrieved_config.auto_backup_interval_hours, 8);
        assert_eq!(retrieved_config.max_backups_to_keep, 10);
        assert_eq!(retrieved_config.backup_directory, PathBuf::from("/custom/backup/path"));
    }
    */

    #[test]
    fn test_backup_metadata_serialization() {
        let metadata = BackupMetadata {
            agent_id: "test-agent-123".to_string(),
            agent_name: "Test Agent".to_string(),
            eliza_version: "1.0.0".to_string(),
            backup_version: "1.0.0".to_string(),
            notes: Some("This is a test backup".to_string()),
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: BackupMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.agent_id, metadata.agent_id);
        assert_eq!(deserialized.agent_name, metadata.agent_name);
        assert_eq!(deserialized.eliza_version, metadata.eliza_version);
        assert_eq!(deserialized.backup_version, metadata.backup_version);
        assert_eq!(deserialized.notes, metadata.notes);
    }
}
