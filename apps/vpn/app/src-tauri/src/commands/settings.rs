//! Settings-related Tauri commands

use crate::config::VPNConfig;
use crate::state::AppState;
use tauri::State;

/// Get current settings
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<VPNConfig, String> {
    let config = state.config.read().await;
    Ok(config.clone())
}

/// Update settings
#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: VPNConfig,
) -> Result<(), String> {
    let mut config = state.config.write().await;
    *config = settings;
    Ok(())
}
