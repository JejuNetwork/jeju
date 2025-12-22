//! Auto-start functionality for Jeju VPN
//!
//! Enables the VPN app to start automatically with the system.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use std::path::PathBuf;

/// Auto-start manager
pub struct AutoStartManager {
    launcher: Option<AutoLaunch>,
}

impl AutoStartManager {
    /// Create a new auto-start manager
    pub fn new() -> Self {
        let launcher = Self::create_launcher();
        Self { launcher }
    }

    fn create_launcher() -> Option<AutoLaunch> {
        // Get the current executable path
        let exe_path = std::env::current_exe().ok()?;
        let exe_name = exe_path.file_name()?.to_str()?;

        // Build the auto-launcher
        let exe_path_str = exe_path.to_string_lossy().to_string();
        let mut builder = AutoLaunchBuilder::new();
        builder.set_app_name("Jeju VPN");
        builder.set_app_path(&exe_path_str);

        // Platform-specific configuration
        #[cfg(target_os = "macos")]
        builder.set_use_launch_agent(true);

        match builder.build() {
            Ok(launcher) => Some(launcher),
            Err(e) => {
                tracing::error!("Failed to create auto-launcher: {}", e);
                None
            }
        }
    }

    /// Check if auto-start is enabled
    pub fn is_enabled(&self) -> bool {
        self.launcher
            .as_ref()
            .and_then(|l| l.is_enabled().ok())
            .unwrap_or(false)
    }

    /// Enable auto-start
    pub fn enable(&self) -> Result<(), String> {
        match &self.launcher {
            Some(launcher) => launcher.enable().map_err(|e| e.to_string()),
            None => Err("Auto-launcher not available".to_string()),
        }
    }

    /// Disable auto-start
    pub fn disable(&self) -> Result<(), String> {
        match &self.launcher {
            Some(launcher) => launcher.disable().map_err(|e| e.to_string()),
            None => Err("Auto-launcher not available".to_string()),
        }
    }

    /// Toggle auto-start
    pub fn toggle(&self) -> Result<bool, String> {
        if self.is_enabled() {
            self.disable()?;
            Ok(false)
        } else {
            self.enable()?;
            Ok(true)
        }
    }
}

impl Default for AutoStartManager {
    fn default() -> Self {
        Self::new()
    }
}

