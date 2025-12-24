//! Auto-start Tauri commands

use crate::autostart::AutoStartManager;
use tauri::State;

#[tauri::command]
pub fn get_autostart_enabled(manager: State<'_, AutoStartManager>) -> bool {
    manager.is_enabled()
}

#[tauri::command]
pub fn set_autostart_enabled(
    enabled: bool,
    manager: State<'_, AutoStartManager>,
) -> Result<(), String> {
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
}

#[tauri::command]
pub fn toggle_autostart(manager: State<'_, AutoStartManager>) -> Result<bool, String> {
    manager.toggle()
}
