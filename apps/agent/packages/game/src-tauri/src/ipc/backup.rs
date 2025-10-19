use crate::backend::state::GlobalAppState;
use crate::backup::{Backup, BackupConfig, BackupType, RestoreOptions};
use tauri::State;
use tracing::{error, info};

#[tauri::command]
pub async fn create_backup(
    state: State<'_, GlobalAppState>,
    backup_type: String,
    notes: Option<String>,
) -> Result<Backup, String> {
    info!("Creating {} backup", backup_type);

    let backup_type = match backup_type.as_str() {
        "manual" => BackupType::Manual,
        "automatic" => BackupType::Automatic,
        "shutdown" => BackupType::Shutdown,
        _ => return Err("Invalid backup type".to_string()),
    };

    let backup_manager = state.backup_manager.read().await;

    match backup_manager.create_backup(backup_type, notes).await {
        Ok(backup) => {
            info!("Backup created successfully: {}", backup.id);
            Ok(backup)
        }
        Err(e) => {
            error!("Failed to create backup: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn restore_backup(
    state: State<'_, GlobalAppState>,
    backup_id: String,
    options: RestoreOptions,
) -> Result<(), String> {
    info!("Restoring backup: {}", backup_id);

    let backup_manager = state.backup_manager.read().await;

    match backup_manager.restore_backup(&backup_id, options).await {
        Ok(()) => {
            info!("Backup restored successfully");
            Ok(())
        }
        Err(e) => {
            error!("Failed to restore backup: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn list_backups(state: State<'_, GlobalAppState>) -> Result<Vec<Backup>, String> {
    let backup_manager = state.backup_manager.read().await;

    match backup_manager.list_backups().await {
        Ok(backups) => Ok(backups),
        Err(e) => {
            error!("Failed to list backups: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn delete_backup(
    state: State<'_, GlobalAppState>,
    backup_id: String,
) -> Result<(), String> {
    info!("Deleting backup: {}", backup_id);

    let backup_manager = state.backup_manager.read().await;

    match backup_manager.delete_backup(&backup_id).await {
        Ok(()) => {
            info!("Backup deleted successfully");
            Ok(())
        }
        Err(e) => {
            error!("Failed to delete backup: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn get_backup_config(state: State<'_, GlobalAppState>) -> Result<BackupConfig, String> {
    let backup_manager = state.backup_manager.read().await;
    Ok(backup_manager.get_config().await)
}

#[tauri::command]
pub async fn update_backup_config(
    state: State<'_, GlobalAppState>,
    config: BackupConfig,
) -> Result<(), String> {
    info!("Updating backup configuration");

    let backup_manager = state.backup_manager.read().await;

    match backup_manager.update_config(config).await {
        Ok(()) => {
            info!("Backup configuration updated successfully");
            Ok(())
        }
        Err(e) => {
            error!("Failed to update backup configuration: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn export_backup(
    state: State<'_, GlobalAppState>,
    backup_id: String,
    export_path: String,
) -> Result<String, String> {
    info!("Exporting backup {} to {}", backup_id, export_path);

    let backup_manager = state.backup_manager.read().await;
    let config = backup_manager.get_config().await;
    let backup_dir = config.backup_directory.join(&backup_id);

    if !backup_dir.exists() {
        return Err(format!("Backup {} not found", backup_id));
    }

    // Create a zip file of the backup directory
    let output_path = std::path::Path::new(&export_path);
    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create export file: {}", e))?;

    let mut zip = zip::ZipWriter::new(file);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Add all files from the backup directory to the zip
    let walkdir = walkdir::WalkDir::new(&backup_dir);
    for entry in walkdir {
        let entry = entry.map_err(|e| format!("Failed to read backup directory: {}", e))?;
        let path = entry.path();

        if path.is_file() {
            let relative_path = path
                .strip_prefix(&backup_dir)
                .map_err(|e| format!("Failed to get relative path: {}", e))?;

            zip.start_file(relative_path.to_string_lossy(), options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;

            let mut file =
                std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
            std::io::copy(&mut file, &mut zip)
                .map_err(|e| format!("Failed to copy file to zip: {}", e))?;
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finish zip: {}", e))?;

    info!("Backup exported successfully to {}", export_path);
    Ok(export_path)
}

#[tauri::command]
pub async fn import_backup(
    state: State<'_, GlobalAppState>,
    import_path: String,
) -> Result<Backup, String> {
    info!("Importing backup from {}", import_path);

    let backup_manager = state.backup_manager.read().await;
    let config = backup_manager.get_config().await;

    // Generate a new backup ID
    let backup_id = uuid::Uuid::new_v4().to_string();
    let backup_dir = config.backup_directory.join(&backup_id);

    // Create the backup directory
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    // Extract the zip file
    let file = std::fs::File::open(&import_path)
        .map_err(|e| format!("Failed to open import file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip file: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let output_path = backup_dir.join(file.name());

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&output_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }

            let mut output_file = std::fs::File::create(&output_path)
                .map_err(|e| format!("Failed to create output file: {}", e))?;
            std::io::copy(&mut file, &mut output_file)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Load and update the manifest with the new ID
    let manifest_path = backup_dir.join("manifest.json");
    let manifest_data = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let mut backup: Backup = serde_json::from_str(&manifest_data)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    // Update the backup ID and paths
    backup.id = backup_id.clone();
    for component in &mut backup.components {
        component.path = backup_dir.join(component.path.file_name().unwrap());
    }

    // Save the updated manifest
    let updated_manifest = serde_json::to_string_pretty(&backup)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    std::fs::write(&manifest_path, updated_manifest)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    info!("Backup imported successfully with ID: {}", backup_id);
    Ok(backup)
}
