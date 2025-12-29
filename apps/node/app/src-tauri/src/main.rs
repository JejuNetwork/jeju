//! Jeju Node - Desktop application for running Jeju infrastructure
//!
//! This application enables users to:
//! - Run compute, storage, oracle, proxy, and other services
//! - Earn rewards for contributing to the network
//! - Manage wallets and staking
//! - Monitor earnings and performance

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod contracts;
mod earnings;
mod hardware;
mod services;
mod state;
mod tee;
mod wallet;

use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "jeju_node=info,tauri=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Jeju Node v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Hardware detection
            commands::hardware::detect_hardware,
            commands::hardware::detect_tee,
            commands::hardware::get_system_info,
            // Wallet management
            commands::wallet::create_wallet,
            commands::wallet::import_wallet,
            commands::wallet::get_wallet_info,
            commands::wallet::get_balance,
            commands::wallet::sign_message,
            commands::wallet::send_transaction,
            // Agent registration (ERC-8004)
            commands::agent::register_agent,
            commands::agent::get_agent_info,
            commands::agent::check_ban_status,
            commands::agent::appeal_ban,
            // Service management
            commands::services::get_available_services,
            commands::services::start_service,
            commands::services::stop_service,
            commands::services::get_service_status,
            commands::services::get_all_service_status,
            // Staking
            commands::staking::get_staking_info,
            commands::staking::stake,
            commands::staking::unstake,
            commands::staking::claim_rewards,
            commands::staking::enable_auto_claim,
            commands::staking::get_pending_rewards,
            // Earnings
            commands::earnings::get_earnings_summary,
            commands::earnings::get_earnings_history,
            commands::earnings::get_projected_earnings,
            commands::earnings::export_earnings,
            // Configuration
            commands::config::get_config,
            commands::config::update_config,
            commands::config::get_network_config,
            commands::config::set_network,
            // Trading bots
            commands::bots::get_available_bots,
            commands::bots::start_bot,
            commands::bots::stop_bot,
            commands::bots::get_bot_status,
            commands::bots::get_bot_earnings,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Initialize state
            let state = app.state::<state::AppState>();
            state.initialize(&handle)?;

            // Set up system tray
            #[cfg(desktop)]
            {
                let tray = app.tray_by_id("main").unwrap();
                tray.on_tray_icon_event(|tray, event| {
                    use tauri::tray::TrayIconEvent;
                    match event {
                        TrayIconEvent::Click { button, .. } => {
                            if let tauri::tray::MouseButton::Left = button {
                                if let Some(window) = tray.app_handle().get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Minimize to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
