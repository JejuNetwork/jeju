//! Jeju VPN - Tauri Application Entry Point
//!
//! A decentralized VPN with:
//! - WireGuard-based secure tunneling
//! - Adaptive bandwidth contribution
//! - DWS integration for edge caching
//! - System tray with quick controls

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod bandwidth;
mod commands;
mod config;
mod contribution;
mod dws;
mod notifications;
mod state;
mod vpn;

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn build_tray_menu(connected: bool) -> SystemTrayMenu {
    let status = if connected {
        CustomMenuItem::new("status", "● Connected").disabled()
    } else {
        CustomMenuItem::new("status", "○ Disconnected").disabled()
    };

    let toggle = if connected {
        CustomMenuItem::new("toggle", "Disconnect")
    } else {
        CustomMenuItem::new("toggle", "Connect")
    };

    SystemTrayMenu::new()
        .add_item(status)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(toggle)
        .add_item(CustomMenuItem::new("locations", "Select Location..."))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("contribution", "Sharing: 10%").disabled())
        .add_item(CustomMenuItem::new("earnings", "Earned: 0 JEJU").disabled())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show", "Show Window"))
        .add_item(CustomMenuItem::new("quit", "Quit"))
}

fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,jeju_vpn=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Jeju VPN...");

    let tray = SystemTray::new().with_menu(build_tray_menu(false));

    tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "toggle" => {
                    let _ = app.emit_all("tray_toggle_vpn", ());
                }
                "locations" | "show" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => std::process::exit(0),
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
            let state = state::AppState::new();
            app.manage(state);
            
            // Initialize auto-start manager
            let autostart = autostart::AutoStartManager::new();
            app.manage(autostart);
            
            // Initialize notification manager
            let notifications = notifications::NotificationManager::new();
            app.manage(notifications);
            
            tracing::info!("Jeju VPN initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vpn::connect,
            commands::vpn::disconnect,
            commands::vpn::get_status,
            commands::vpn::get_nodes,
            commands::vpn::select_node,
            commands::vpn::get_connection_stats,
            commands::contribution::get_contribution_status,
            commands::contribution::set_contribution_settings,
            commands::contribution::get_contribution_stats,
            commands::auth::login_with_wallet,
            commands::auth::logout,
            commands::auth::get_session,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::bandwidth::get_bandwidth_state,
            commands::bandwidth::set_adaptive_mode,
            commands::dws::get_dws_state,
            commands::dws::set_dws_enabled,
            commands::autostart::get_autostart_enabled,
            commands::autostart::set_autostart_enabled,
            commands::autostart::toggle_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

