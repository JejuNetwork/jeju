//! Contribution-related Tauri commands

use crate::contribution::{ContributionSettings, ContributionStats, ContributionStatus};
use crate::state::AppState;
use tauri::State;

/// Get contribution status
#[tauri::command]
pub async fn get_contribution_status(
    state: State<'_, AppState>,
) -> Result<ContributionStatus, String> {
    let contribution = state.contribution.read().await;
    Ok(contribution.get_status())
}

/// Set contribution settings
#[tauri::command]
pub async fn set_contribution_settings(
    state: State<'_, AppState>,
    settings: ContributionSettings,
) -> Result<(), String> {
    let mut contribution = state.contribution.write().await;
    contribution.update_settings(settings);
    Ok(())
}

/// Get contribution statistics
#[tauri::command]
pub async fn get_contribution_stats(
    state: State<'_, AppState>,
) -> Result<ContributionStats, String> {
    let contribution = state.contribution.read().await;
    Ok(contribution.get_stats())
}
