use crate::backend::{BackendError, BackendResult};
use sysinfo::System;
use tracing::{info, warn};

/// Memory allocation configuration for Podman machine
#[derive(Debug, Clone)]
pub struct MemoryConfig {
    /// Total system memory in MB
    pub total_system_memory_mb: u64,
    /// Recommended Podman machine memory in MB
    pub podman_machine_memory_mb: u64,
    /// Minimum required memory for llama3.2:3b model
    pub min_required_mb: u64,
    /// Whether the system has enough memory
    pub has_sufficient_memory: bool,
}

impl MemoryConfig {
    /// Calculate appropriate memory allocation based on system resources
    pub fn calculate() -> Self {
        let mut sys = System::new_all();
        sys.refresh_memory();

        // On macOS, sysinfo returns memory in bytes, not KB
        // On other systems, it returns KB
        let total_memory_raw = sys.total_memory();
        let total_memory_mb = if cfg!(target_os = "macos") {
            // On macOS, the value is in bytes
            total_memory_raw / 1024 / 1024
        } else {
            // On other systems, convert from KB to MB
            total_memory_raw / 1024
        };
        let total_memory_gb = total_memory_mb as f64 / 1024.0;

        info!(
            "System total memory: {:.1} GB ({} MB)",
            total_memory_gb, total_memory_mb
        );

        // Minimum requirements:
        // - llama3.2:3b needs ~3.4GB for inference
        // - Add 1.5GB for Ollama overhead and other containers
        // - Total minimum: 5GB (5120 MB)
        let min_required_mb = 5120;

        // Calculate Podman machine allocation based on system memory
        let podman_machine_memory_mb = match total_memory_mb {
            // For 8GB systems: allocate 6.5GB (6656 MB) - leaving 1.5GB for host
            0..=8192 => {
                if total_memory_mb >= 7680 {
                    // At least 7.5GB total
                    6656
                } else {
                    warn!("System has less than 8GB RAM. Model performance may be limited.");
                    std::cmp::min(total_memory_mb.saturating_sub(1536), 6656)
                }
            }
            // For 16GB systems: allocate 12GB
            8193..=16384 => 12288,
            // For 32GB systems: allocate 24GB
            16385..=32768 => 24576,
            // For 64GB systems: allocate 48GB
            32769..=65536 => 49152,
            // For 128GB+ systems: allocate 64GB max
            _ => 65536,
        };

        let has_sufficient_memory = podman_machine_memory_mb >= min_required_mb;

        info!(
            "Calculated Podman machine memory: {} MB ({:.1} GB)",
            podman_machine_memory_mb,
            podman_machine_memory_mb as f64 / 1024.0
        );

        MemoryConfig {
            total_system_memory_mb: total_memory_mb,
            podman_machine_memory_mb,
            min_required_mb,
            has_sufficient_memory,
        }
    }

    /// Get the current Podman machine memory allocation
    pub async fn get_current_podman_memory() -> BackendResult<Option<u64>> {
        let output = tokio::process::Command::new("podman")
            .args(["machine", "inspect", "podman-machine-default"])
            .output()
            .await
            .map_err(|e| {
                BackendError::Container(format!("Failed to inspect Podman machine: {}", e))
            })?;

        if !output.status.success() {
            return Ok(None);
        }

        let output_str = String::from_utf8_lossy(&output.stdout);

        // Parse JSON output to find memory allocation
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&output_str) {
            if let Some(machines) = json.as_array() {
                if let Some(machine) = machines.first() {
                    if let Some(resources) = machine.get("Resources") {
                        if let Some(memory) = resources.get("Memory") {
                            if let Some(memory_mb) = memory.as_u64() {
                                return Ok(Some(memory_mb));
                            }
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// Check if Podman machine needs memory adjustment
    pub async fn needs_memory_adjustment(&self) -> BackendResult<bool> {
        match Self::get_current_podman_memory().await? {
            Some(current_mb) => {
                info!("Current Podman machine memory: {} MB", current_mb);
                Ok(current_mb < self.podman_machine_memory_mb)
            }
            None => Ok(true), // If we can't determine, assume we need to set it
        }
    }

    /// Apply memory configuration to Podman machine
    pub async fn apply_to_podman_machine(&self) -> BackendResult<()> {
        if !self.has_sufficient_memory {
            return Err(BackendError::Container(format!(
                "Insufficient system memory. Need at least {} MB, but only {} MB would be allocated",
                self.min_required_mb,
                self.podman_machine_memory_mb
            )));
        }

        info!(
            "Configuring Podman machine with {} MB memory",
            self.podman_machine_memory_mb
        );

        // Stop the machine first if it's running
        let _ = tokio::process::Command::new("podman")
            .args(["machine", "stop"])
            .output()
            .await;

        // Wait for clean shutdown
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Set the memory
        let set_output = tokio::process::Command::new("podman")
            .args([
                "machine",
                "set",
                "--memory",
                &self.podman_machine_memory_mb.to_string(),
            ])
            .output()
            .await
            .map_err(|e| {
                BackendError::Container(format!("Failed to set Podman machine memory: {}", e))
            })?;

        if !set_output.status.success() {
            let stderr = String::from_utf8_lossy(&set_output.stderr);
            return Err(BackendError::Container(format!(
                "Failed to configure Podman machine memory: {}",
                stderr
            )));
        }

        info!("✅ Podman machine memory configured successfully");
        Ok(())
    }

    /// Get container memory limits based on available Podman machine memory
    pub fn get_container_limits(&self) -> ContainerMemoryLimits {
        // Reserve some memory for Podman VM overhead (512MB)
        let available_mb = self.podman_machine_memory_mb.saturating_sub(512);

        // Allocate memory to containers
        let ollama_mb = if available_mb >= 16384 {
            // For 16GB+ Podman machines, give Ollama plenty of room
            std::cmp::min(available_mb * 70 / 100, 32768) // 70% or max 32GB
        } else if available_mb >= 8192 {
            // For 8-16GB, give Ollama most of the memory
            available_mb * 75 / 100
        } else {
            // For <8GB, give Ollama as much as possible while leaving room for other containers
            available_mb.saturating_sub(1024) // Leave 1GB for PostgreSQL and agent
        };

        // PostgreSQL gets a modest allocation
        let postgres_mb = std::cmp::min(2048, available_mb / 8); // 2GB or 1/8 of available

        // Agent gets the remainder, minimum 1GB
        let agent_mb = std::cmp::max(1024, available_mb.saturating_sub(ollama_mb + postgres_mb));

        ContainerMemoryLimits {
            ollama_mb,
            postgres_mb,
            agent_mb,
        }
    }
}

/// Container memory limits calculated based on available resources
#[derive(Debug, Clone)]
pub struct ContainerMemoryLimits {
    pub ollama_mb: u64,
    pub postgres_mb: u64,
    pub agent_mb: u64,
}

impl ContainerMemoryLimits {
    /// Convert to Docker/Podman memory limit strings
    pub fn ollama_limit_str(&self) -> String {
        format!("{}m", self.ollama_mb)
    }

    pub fn postgres_limit_str(&self) -> String {
        format!("{}m", self.postgres_mb)
    }

    pub fn agent_limit_str(&self) -> String {
        format!("{}m", self.agent_mb)
    }
}
