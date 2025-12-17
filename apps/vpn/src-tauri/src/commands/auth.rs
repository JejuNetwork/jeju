//! Authentication-related Tauri commands

use crate::state::{AppState, UserSession};
use tauri::State;

/// Login with wallet signature
#[tauri::command]
pub async fn login_with_wallet(
    state: State<'_, AppState>,
    address: String,
    signature: String,
    message: String,
) -> Result<UserSession, String> {
    // TODO: Verify signature and create session via OAuth3
    
    let session = UserSession {
        address: address.clone(),
        session_id: uuid::Uuid::new_v4().to_string(),
        expires_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() + 24 * 60 * 60, // 24 hours
    };
    
    *state.session.write().await = Some(session.clone());
    
    Ok(session)
}

/// Logout
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.write().await = None;
    Ok(())
}

/// Get current session
#[tauri::command]
pub async fn get_session(state: State<'_, AppState>) -> Result<Option<UserSession>, String> {
    Ok(state.session.read().await.clone())
}

