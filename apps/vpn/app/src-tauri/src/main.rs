//! Jeju VPN - Tauri v2 Application Entry Point
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
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Build the system tray menu based on connection state
fn build_tray_menu(
    app: &AppHandle,
    connected: bool,
    location: Option<&str>,
    contribution_percent: u8,
) -> tauri::Result<Menu<tauri::Wry>> {
    let status_text = if connected {
        match location {
            Some(loc) => format!("● Connected to {}", loc),
            None => "● Connected".to_string(),
        }
    } else {
        "○ Disconnected".to_string()
    };

    let toggle_text = if connected {
        "⏹ Disconnect"
    } else {
        "▶ Connect"
    };

    let contribution_text = format!("↑ Sharing: {}%", contribution_percent);

    let pause_text = if connected {
        "⏸ Pause Sharing"
    } else {
        "Sharing Paused"
    };

    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "status", status_text, false, None::<&str>)?,
            &MenuItem::with_id(app, "separator1", "─────────────", false, None::<&str>)?,
            &MenuItem::with_id(app, "toggle", toggle_text, true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "locations",
                "🌍 Select Location...",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "separator2", "─────────────", false, None::<&str>)?,
            &MenuItem::with_id(app, "contribution", contribution_text, false, None::<&str>)?,
            &MenuItem::with_id(app, "pause_sharing", pause_text, true, None::<&str>)?,
            &MenuItem::with_id(app, "separator3", "─────────────", false, None::<&str>)?,
            &MenuItem::with_id(app, "show", "📱 Show Window", true, None::<&str>)?,
            &MenuItem::with_id(app, "preferences", "⚙ Preferences...", true, None::<&str>)?,
            &MenuItem::with_id(app, "separator4", "─────────────", false, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "Quit Jeju VPN", true, None::<&str>)?,
        ],
    )
}

/// Update the system tray menu
pub fn update_tray_menu(
    app: &AppHandle,
    connected: bool,
    location: Option<&str>,
    contribution_percent: u8,
) {
    if let Ok(menu) = build_tray_menu(app, connected, location, contribution_percent) {
        if let Some(tray) = app.tray_by_id("main") {
            if let Err(e) = tray.set_menu(Some(menu)) {
                tracing::warn!("Failed to update tray menu: {}", e);
            }
        }
    }
}

fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,jeju_vpn=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Jeju VPN...");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let state = state::AppState::new();
            app.manage(state);

            // Initialize auto-start manager
            let autostart = autostart::AutoStartManager::new();
            app.manage(autostart);

            // Initialize notification manager
            let notifications = notifications::NotificationManager::new();
            app.manage(notifications);

            // Build initial tray menu
            let menu = build_tray_menu(app.handle(), false, None, 10)?;

            // Create system tray
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("No icon"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .title("Jeju VPN")
                .tooltip("Jeju VPN - Disconnected")
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            // On left click, show/focus the main window
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.set_focus();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            // On double click, toggle VPN
                            let _ = app.emit("tray_toggle_vpn", ());
                        }
                        _ => {}
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "toggle" => {
                            let _ = app.emit("tray_toggle_vpn", ());
                        }
                        "locations" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                // Navigate to location selection
                                let _ = app.emit("navigate", "locations");
                            }
                        }
                        "pause_sharing" => {
                            let _ = app.emit("toggle_sharing", ());
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "preferences" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = app.emit("navigate", "settings");
                            }
                        }
                        "quit" => {
                            // Emit quit event to allow cleanup
                            let _ = app.emit("app_quit", ());
                            // Give time for cleanup
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Register global shortcuts
            let app_handle = app.handle().clone();

            // Cmd/Ctrl+Shift+V to toggle VPN
            let toggle_modifier = if cfg!(target_os = "macos") {
                Modifiers::META | Modifiers::SHIFT
            } else {
                Modifiers::CONTROL | Modifiers::SHIFT
            };

            let toggle_shortcut = Shortcut::new(Some(toggle_modifier), Code::KeyV);
            let app_handle_toggle = app_handle.clone();
            if let Err(e) = app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, shortcut, _event| {
                        if shortcut == &toggle_shortcut {
                            let _ = app_handle_toggle.emit("tray_toggle_vpn", ());
                        }
                    })
                    .build(),
            ) {
                tracing::warn!("Failed to register toggle shortcut plugin: {}", e);
            }

            tracing::info!("Jeju VPN initialized");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle window close - minimize to tray instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the window from closing
                api.prevent_close();
                // Hide the window instead
                let _ = window.hide();
                tracing::debug!("Window hidden to tray");
            }
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

    app.run(|_app_handle, event| {
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

    // Update tray tooltip
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if connected {
            match &location {
                Some(loc) => format!("Jeju VPN - Connected to {}", loc),
                None => "Jeju VPN - Connected".to_string(),
            }
        } else {
            "Jeju VPN - Disconnected".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}
