//! DWS integration commands

use crate::state::AppState;
use crate::dws::DWSState;
use tauri::State;

/// Get current DWS state
#[tauri::command]
pub async fn get_dws_state(state: State<'_, AppState>) -> Result<DWSState, String> {
    let dws = state.dws.read().await;
    Ok(dws.get_state().await)
}

/// Enable/disable DWS service
#[tauri::command]
pub async fn set_dws_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let mut dws = state.dws.write().await;
    if enabled {
        dws.start().await?;
    } else {
        dws.stop().await;
    }
    Ok(())
}



