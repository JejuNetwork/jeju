use crate::backend::{BackendError, BackendResult};
use std::process::Command;
use tracing::{info, warn};

/// Common container name constants
pub const POSTGRES_CONTAINER: &str = "eliza-postgres";
pub const OLLAMA_CONTAINER: &str = "eliza-ollama";
pub const AGENT_CONTAINER: &str = "eliza-agent";
pub const NETWORK_NAME: &str = "eliza-network";

/// Checks if a port is available by attempting to bind to it
/// Note: Kept as utility function that may be useful for port conflict detection
#[allow(dead_code)]
pub fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Kills processes running on a specific port (cross-platform)
pub async fn kill_processes_on_port(port: u16) -> BackendResult<()> {
    info!("🔍 Checking for existing processes on port {}...", port);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to run lsof: {}", e)))?;

        if output.status.success() && !output.stdout.is_empty() {
            let pids_str = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<&str> = pids_str.trim().split('\n').collect();

            if !pids.is_empty() && !pids[0].is_empty() {
                info!(
                    "🚫 Found {} process(es) using port {}: {:?}",
                    pids.len(),
                    port,
                    pids
                );

                for pid in pids {
                    if !pid.trim().is_empty() {
                        info!("🔪 Killing process with PID: {}", pid.trim());

                        // Try SIGTERM first (graceful shutdown)
                        let kill_result = Command::new("kill").args(["-TERM", pid.trim()]).output();

                        match kill_result {
                            Ok(kill_output) => {
                                if kill_output.status.success() {
                                    info!("✅ Successfully terminated process {}", pid.trim());
                                } else {
                                    // If SIGTERM failed, try SIGKILL
                                    warn!(
                                        "⚠️ SIGTERM failed for PID {}, trying SIGKILL...",
                                        pid.trim()
                                    );
                                    let force_kill =
                                        Command::new("kill").args(["-KILL", pid.trim()]).output();

                                    if let Ok(force_output) = force_kill {
                                        if force_output.status.success() {
                                            info!("✅ Force killed process {}", pid.trim());
                                        } else {
                                            warn!("❌ Failed to force kill process {}", pid.trim());
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("❌ Failed to kill process {}: {}", pid.trim(), e);
                            }
                        }
                    }
                }
            } else {
                info!("✅ No processes found using port {}", port);
            }
        } else {
            info!("✅ No processes found using port {}", port);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netstat")
            .args(["-ano", "|", "findstr", &format!(":{}", port)])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to run netstat: {}", e)))?;

        if output.status.success() && !output.stdout.is_empty() {
            // Parse Windows netstat output and kill processes
            warn!("⚠️ Port killing on Windows not fully implemented");
        }
    }

    Ok(())
}

/// Gets the data directory path for containers
/// Note: Kept as utility function for future persistent storage needs
#[allow(dead_code)]
pub fn get_container_data_dir() -> BackendResult<std::path::PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| BackendError::Config("Could not determine data directory".to_string()))?
        .join("eliza-game")
        .join("containers");

    std::fs::create_dir_all(&data_dir).map_err(BackendError::Io)?;

    Ok(data_dir)
}
