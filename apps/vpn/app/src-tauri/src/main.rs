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
    AppHandle, CustomMenuItem, GlobalShortcutManager, Manager, RunEvent, SystemTray,
    SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, WindowEvent,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Build the system tray menu based on connection state
fn build_tray_menu(
    connected: bool,
    location: Option<&str>,
    contribution_percent: u8,
) -> SystemTrayMenu {
    let status_text = if connected {
        match location {
            Some(loc) => format!("● Connected to {}", loc),
            None => "● Connected".to_string(),
        }
    } else {
        "○ Disconnected".to_string()
    };

    let status = CustomMenuItem::new("status", status_text).disabled();

    let toggle = if connected {
        CustomMenuItem::new("toggle", "⏹ Disconnect")
    } else {
        CustomMenuItem::new("toggle", "▶ Connect")
    };

    let contribution_text = format!("↑ Sharing: {}%", contribution_percent);

    SystemTrayMenu::new()
        .add_item(status)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(toggle)
        .add_item(CustomMenuItem::new("locations", "🌍 Select Location..."))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("contribution", contribution_text).disabled())
        .add_item(CustomMenuItem::new(
            "pause_sharing",
            if connected {
                "⏸ Pause Sharing"
            } else {
                "Sharing Paused"
            },
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show", "📱 Show Window"))
        .add_item(CustomMenuItem::new("preferences", "⚙ Preferences..."))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit Jeju VPN"))
}

/// Update the system tray icon based on connection state
fn update_tray_icon(app: &AppHandle, connected: bool) {
    let icon_path = if connected {
        "icons/icon-connected.png"
    } else {
        "icons/icon-disconnected.png"
    };

    if let Err(e) = app
        .tray_handle()
        .set_icon(tauri::Icon::File(icon_path.into()))
    {
        tracing::warn!("Failed to update tray icon: {}", e);
    }
}

/// Update the system tray menu
pub fn update_tray_menu(
    app: &AppHandle,
    connected: bool,
    location: Option<&str>,
    contribution_percent: u8,
) {
    let menu = build_tray_menu(connected, location, contribution_percent);
    if let Err(e) = app.tray_handle().set_menu(menu) {
        tracing::warn!("Failed to update tray menu: {}", e);
    }
    update_tray_icon(app, connected);
}

fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,jeju_vpn=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Jeju VPN...");

    let tray = SystemTray::new().with_menu(build_tray_menu(false, None, 10));

    let app = tauri::Builder::default()
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                // On left click, show/focus the main window
                if let Some(window) = app.get_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.set_focus();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            SystemTrayEvent::DoubleClick { .. } => {
                // On double click, toggle VPN
                let _ = app.emit_all("tray_toggle_vpn", ());
            }
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "toggle" => {
                        let _ = app.emit_all("tray_toggle_vpn", ());
                    }
                    "locations" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            // Navigate to location selection
                            let _ = app.emit_all("navigate", "locations");
                        }
                    }
                    "pause_sharing" => {
                        let _ = app.emit_all("toggle_sharing", ());
                    }
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "preferences" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit_all("navigate", "settings");
                        }
                    }
                    "quit" => {
                        // Emit quit event to allow cleanup
                        let _ = app.emit_all("app_quit", ());
                        // Give time for cleanup
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        std::process::exit(0);
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .on_window_event(|event| {
            // Handle window close - minimize to tray instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = event.event() {
                // Prevent the window from closing
                api.prevent_close();
                // Hide the window instead
                let window = event.window();
                let _ = window.hide();

                // Show a notification that the app is still running
                #[cfg(target_os = "macos")]
                {
                    // macOS shows apps in dock, so this is less necessary
                }
                #[cfg(not(target_os = "macos"))]
                {
                    if let Ok(manager) = window
                        .app_handle()
                        .try_state::<notifications::NotificationManager>()
                    {
                        // Don't spam notifications on every close
                    }
                }

                tracing::debug!("Window hidden to tray");
            }
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

            // Register global shortcuts
            let app_handle = app.handle();
            let mut shortcut_manager = app.global_shortcut_manager();

            // Cmd/Ctrl+Shift+V to toggle VPN
            let toggle_shortcut = if cfg!(target_os = "macos") {
                "Cmd+Shift+V"
            } else {
                "Ctrl+Shift+V"
            };

            if let Err(e) = shortcut_manager.register(toggle_shortcut, move || {
                let _ = app_handle.emit_all("tray_toggle_vpn", ());
            }) {
                tracing::warn!("Failed to register global shortcut: {}", e);
            }

            // Cmd/Ctrl+Shift+J to show window
            let show_shortcut = if cfg!(target_os = "macos") {
                "Cmd+Shift+J"
            } else {
                "Ctrl+Shift+J"
            };

            let app_handle2 = app.handle();
            if let Err(e) = shortcut_manager.register(show_shortcut, move || {
                if let Some(window) = app_handle2.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }) {
                tracing::warn!("Failed to register show shortcut: {}", e);
            }

            tracing::info!("Jeju VPN initialized");
            tracing::info!(
                "Shortcuts: {} (toggle VPN), {} (show window)",
                toggle_shortcut,
                show_shortcut
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vpn::connect,
            commands::vpn::disconnect,
            commands::vpn::get_status,
            commands::vpn::get_nodes,
            commands::vpn::select_node,
            commands::vpn::get_connection_stats,
            commands::vpn::get_public_key,
            commands::contribution::get_contribution_status,
            commands::contribution::get_contribution_settings,
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
            update_tray_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            // Prevent exit, minimize to tray
            api.prevent_exit();
        }
    });
}

/// Command to update tray state from frontend
#[tauri::command]
fn update_tray_state(
    app: tauri::AppHandle,
    connected: bool,
    location: Option<String>,
    contribution_percent: u8,
) {
    update_tray_menu(&app, connected, location.as_deref(), contribution_percent);
}
