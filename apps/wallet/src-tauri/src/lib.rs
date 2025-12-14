//! Jeju Wallet - Tauri Desktop Application
//!
//! This module provides the native backend for the Jeju Wallet desktop application.
//! It handles:
//! - Secure key storage via OS keychain
//! - Deep link handling
//! - Native notifications
//! - File system access for wallet data

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SERVICE_NAME: &str = "network.jeju.wallet";

/// Result type for keyring operations
#[derive(Debug, Serialize, Deserialize)]
pub struct KeyringResult {
    pub success: bool,
    pub value: Option<String>,
    pub error: Option<String>,
}

/// Get a value from the system keychain
#[tauri::command]
pub fn keyring_get(service: Option<String>, key: String) -> KeyringResult {
    let svc = service.unwrap_or_else(|| SERVICE_NAME.to_string());
    
    match keyring::Entry::new(&svc, &key) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => KeyringResult {
                success: true,
                value: Some(password),
                error: None,
            },
            Err(keyring::Error::NoEntry) => KeyringResult {
                success: true,
                value: None,
                error: None,
            },
            Err(e) => KeyringResult {
                success: false,
                value: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => KeyringResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}

/// Set a value in the system keychain
#[tauri::command]
pub fn keyring_set(service: Option<String>, key: String, value: String) -> KeyringResult {
    let svc = service.unwrap_or_else(|| SERVICE_NAME.to_string());
    
    match keyring::Entry::new(&svc, &key) {
        Ok(entry) => match entry.set_password(&value) {
            Ok(()) => KeyringResult {
                success: true,
                value: None,
                error: None,
            },
            Err(e) => KeyringResult {
                success: false,
                value: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => KeyringResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}

/// Delete a value from the system keychain
#[tauri::command]
pub fn keyring_delete(service: Option<String>, key: String) -> KeyringResult {
    let svc = service.unwrap_or_else(|| SERVICE_NAME.to_string());
    
    match keyring::Entry::new(&svc, &key) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => KeyringResult {
                success: true,
                value: None,
                error: None,
            },
            Err(keyring::Error::NoEntry) => KeyringResult {
                success: true,
                value: None,
                error: None,
            },
            Err(e) => KeyringResult {
                success: false,
                value: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => KeyringResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}

/// Handle deep link events
fn handle_deep_link(app: &AppHandle, url: String) {
    // Emit the deep link to the frontend
    if let Err(e) = app.emit("deep-link", url.clone()) {
        eprintln!("Failed to emit deep-link event: {}", e);
    }
    
    // Focus the main window
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Register deep link handler
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                app.listen("deep-link://new", move |event| {
                    if let Some(urls) = event.payload().as_str() {
                        handle_deep_link(&handle, urls.to_string());
                    }
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            keyring_get,
            keyring_set,
            keyring_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jeju Wallet");
}

