//! Bandwidth management commands

use crate::bandwidth::BandwidthState;
use crate::state::AppState;
use tauri::State;

/// Get current bandwidth state
#[tauri::command]
pub async fn get_bandwidth_state(state: State<'_, AppState>) -> Result<BandwidthState, String> {
    let bandwidth = state.bandwidth.read().await;
    Ok(bandwidth.get_state().await)
}

/// Enable/disable adaptive bandwidth mode
#[tauri::command]
pub async fn set_adaptive_mode(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let bandwidth = state.bandwidth.read().await;
    bandwidth.set_adaptive_enabled(enabled).await;
    Ok(())
}
