//! Jeju Wallet - Tauri Desktop Application
//!
//! This module provides the native backend for the Jeju Wallet desktop application.
//! It handles:
//! - Secure key storage via OS keychain
//! - Deep link handling
//! - Native notifications
//! - File system access for wallet data

mod commands;

use tauri::{AppHandle, Emitter, Listener, Manager};

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
                    handle_deep_link(&handle, event.payload().to_string());
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::keyring_get,
            commands::keyring_set,
            commands::keyring_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jeju Wallet");
}
