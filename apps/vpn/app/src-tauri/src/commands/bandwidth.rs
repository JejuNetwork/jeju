//! Bandwidth management commands

use crate::bandwidth::BandwidthState;
use crate::state::AppState;
use tauri::State;

/// Get current bandwidth state
#[tauri::command]
pub async fn get_bandwidth_state(state: State<'_, AppState>) -> Result<BandwidthState, String> {
    // Get the manager first
    let manager = state.bandwidth.read().await;
    // Get the inner state Arc
    let state_arc = manager.state_arc();
    // Drop the manager guard before the next await
    drop(manager);
    // Now await on the inner state
    let bandwidth_state = state_arc.read().await.clone();
    Ok(bandwidth_state)
}

/// Enable/disable adaptive bandwidth mode
#[tauri::command]
pub async fn set_adaptive_mode(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    // Get the manager first
    let manager = state.bandwidth.read().await;
    // Get the inner state Arc
    let state_arc = manager.state_arc();
    // Drop the manager guard before the next await
    drop(manager);
    // Now await on the inner state
    state_arc.write().await.adaptive_enabled = enabled;
    Ok(())
}
