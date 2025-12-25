//! VPN-related Tauri commands
//!
//! These commands expose VPN functionality to the frontend via Tauri IPC.
//! The underlying implementation uses Cloudflare's boringtun for WireGuard.

use crate::state::AppState;
use crate::vpn::{ConnectionStats, ConnectionStatus, VPNConnection, VPNNode};
use tauri::State;

/// Connect to VPN using boringtun WireGuard tunnel
#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    node_id: Option<String>,
) -> Result<VPNConnection, String> {
    let mut vpn = state.vpn.write().await;

    // Find node by ID if specified
    let node = if let Some(id) = node_id {
        let nodes = vpn.get_nodes(None).await.map_err(|e| e.to_string())?;
        nodes.into_iter().find(|n| n.node_id == id)
    } else {
        None
    };

    vpn.connect(node).await.map_err(|e| e.to_string())
}

/// Get our WireGuard public key (for peer configuration)
#[tauri::command]
pub async fn get_public_key(state: State<'_, AppState>) -> Result<String, String> {
    let vpn = state.vpn.read().await;
    Ok(vpn.public_key().to_string())
}

/// Disconnect from VPN
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut vpn = state.vpn.write().await;
    vpn.disconnect().await.map_err(|e| e.to_string())
}

/// Get VPN connection status
#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<VPNStatusResponse, String> {
    let vpn = state.vpn.read().await;

    Ok(VPNStatusResponse {
        status: vpn.get_status(),
        connection: vpn.get_connection().cloned(),
    })
}

/// Get available VPN nodes
#[tauri::command]
pub async fn get_nodes(
    state: State<'_, AppState>,
    country_code: Option<String>,
) -> Result<Vec<VPNNode>, String> {
    let mut vpn = state.vpn.write().await;
    vpn.get_nodes(country_code).await.map_err(|e| e.to_string())
}

/// Select a specific node
#[tauri::command]
pub async fn select_node(state: State<'_, AppState>, node_id: String) -> Result<(), String> {
    let mut vpn = state.vpn.write().await;
    vpn.select_node(node_id);
    Ok(())
}

/// Get connection statistics
#[tauri::command]
pub async fn get_connection_stats(
    state: State<'_, AppState>,
) -> Result<Option<ConnectionStats>, String> {
    let vpn = state.vpn.read().await;
    Ok(vpn.get_stats().await)
}

/// Response for get_status command
#[derive(serde::Serialize)]
pub struct VPNStatusResponse {
    pub status: ConnectionStatus,
    pub connection: Option<VPNConnection>,
}
