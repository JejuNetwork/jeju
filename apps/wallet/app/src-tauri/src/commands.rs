//! Tauri commands for keyring operations

use serde::{Deserialize, Serialize};

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
        Ok(entry) => match entry.delete_password() {
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
