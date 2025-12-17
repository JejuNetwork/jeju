//! Jeju VPN - Tauri Application Entry Point

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod contribution;
mod state;
mod vpn;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,jeju_vpn=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Jeju VPN...");

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Initialize app state
            let state = state::AppState::new();
            app.manage(state);

            // Setup system tray
            #[cfg(desktop)]
            {
                let tray = app.tray_by_id("main").unwrap();
                tray.on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }

            tracing::info!("Jeju VPN initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // VPN commands
            commands::vpn::connect,
            commands::vpn::disconnect,
            commands::vpn::get_status,
            commands::vpn::get_nodes,
            commands::vpn::select_node,
            commands::vpn::get_connection_stats,
            // Contribution commands
            commands::contribution::get_contribution_status,
            commands::contribution::set_contribution_settings,
            commands::contribution::get_contribution_stats,
            // Auth commands
            commands::auth::login_with_wallet,
            commands::auth::logout,
            commands::auth::get_session,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

