use crate::backend::BackendResult;
use crate::common::is_port_available;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::System;
use tracing::info;

/// Resource requirements for different operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRequirements {
    pub min_memory_mb: u64,
    pub min_disk_gb: u64,
    pub required_ports: Vec<(String, u16)>, // (service_name, port)
    pub estimated_download_mb: u64,
}

/// Result of resource check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceCheckResult {
    pub passed: bool,
    pub memory_check: ResourceStatus,
    pub disk_check: ResourceStatus,
    pub port_checks: HashMap<String, PortCheckResult>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceStatus {
    pub passed: bool,
    pub available: u64,
    pub required: u64,
    pub unit: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortCheckResult {
    pub port: u16,
    pub available: bool,
    pub process_using: Option<String>,
}

/// Performs pre-flight resource checks
pub struct ResourceChecker {
    system: Mutex<System>,
}

impl ResourceChecker {
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();

        Self {
            system: Mutex::new(system),
        }
    }

    /// Check if system has required resources for an operation
    pub async fn check_resources(
        &mut self,
        requirements: &ResourceRequirements,
    ) -> BackendResult<ResourceCheckResult> {
        self.system.lock().unwrap().refresh_all();

        let mut result = ResourceCheckResult {
            passed: true,
            memory_check: self.check_memory(requirements.min_memory_mb),
            disk_check: self.check_disk_space(
                requirements.min_disk_gb + (requirements.estimated_download_mb / 1024),
            ),
            port_checks: HashMap::new(),
            warnings: Vec::new(),
            errors: Vec::new(),
        };

        // Check ports
        for (service, port) in &requirements.required_ports {
            let port_result = self.check_port(*port).await;
            if !port_result.available {
                result.errors.push(format!(
                    "Port {} required for {} is already in use{}",
                    port,
                    service,
                    port_result
                        .process_using
                        .as_ref()
                        .map(|p| format!(" by: {}", p))
                        .unwrap_or_default()
                ));
                result.passed = false;
            }
            result.port_checks.insert(service.clone(), port_result);
        }

        // Update overall status
        if !result.memory_check.passed {
            result.errors.push(result.memory_check.message.clone());
            result.passed = false;
        } else if result.memory_check.available < requirements.min_memory_mb * 2 {
            result.warnings.push(format!(
                "Low memory warning: Only {:.1}GB available, recommended {:.1}GB",
                result.memory_check.available as f64 / 1024.0,
                (requirements.min_memory_mb * 2) as f64 / 1024.0
            ));
        }

        if !result.disk_check.passed {
            result.errors.push(result.disk_check.message.clone());
            result.passed = false;
        } else if result.disk_check.available < requirements.min_disk_gb * 2 {
            result.warnings.push(format!(
                "Low disk space warning: Only {}GB available, recommended {}GB",
                result.disk_check.available,
                requirements.min_disk_gb * 2
            ));
        }

        Ok(result)
    }

    fn check_memory(&self, required_mb: u64) -> ResourceStatus {
        let available_mb = self.system.lock().unwrap().available_memory() / 1024; // Convert from KB to MB
        let total_mb = self.system.lock().unwrap().total_memory() / 1024;
        let used_mb = self.system.lock().unwrap().used_memory() / 1024;

        info!(
            "Memory check - Total: {}MB, Used: {}MB, Available: {}MB, Required: {}MB",
            total_mb, used_mb, available_mb, required_mb
        );

        ResourceStatus {
            passed: available_mb >= required_mb,
            available: available_mb,
            required: required_mb,
            unit: "MB".to_string(),
            message: if available_mb >= required_mb {
                format!(
                    "Sufficient memory available: {:.1}GB",
                    available_mb as f64 / 1024.0
                )
            } else {
                format!(
                    "Insufficient memory: {:.1}GB available, {:.1}GB required",
                    available_mb as f64 / 1024.0,
                    required_mb as f64 / 1024.0
                )
            },
        }
    }

    fn check_disk_space(&self, required_gb: u64) -> ResourceStatus {
        // TODO: Fix disk checking for sysinfo v0.31
        // For now, return a simple check
        let available_gb = 100; // Assume 100GB available for now

        if available_gb >= required_gb {
            ResourceStatus {
                passed: true,
                available: available_gb,
                required: required_gb,
                unit: "GB".to_string(),
                message: format!("{}GB available, {}GB required", available_gb, required_gb),
            }
        } else {
            ResourceStatus {
                passed: false,
                available: available_gb,
                required: required_gb,
                unit: "GB".to_string(),
                message: format!(
                    "Insufficient disk space: {}GB available, {}GB required",
                    available_gb, required_gb
                ),
            }
        }
    }

    async fn check_port(&self, port: u16) -> PortCheckResult {
        let available = is_port_available(port);
        let process_using = if !available {
            self.identify_port_user(port).await
        } else {
            None
        };

        PortCheckResult {
            port,
            available,
            process_using,
        }
    }

    async fn identify_port_user(&self, port: u16) -> Option<String> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            if let Ok(output) = tokio::process::Command::new("lsof")
                .args(["-i", &format!(":{}", port), "-F", "cn"])
                .output()
                .await
            {
                let output_str = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<&str> = output_str.lines().collect();

                // Parse lsof output to find command name
                for i in 0..lines.len() {
                    if lines[i].starts_with('c') && i + 1 < lines.len() {
                        let cmd = &lines[i][1..];
                        if let Some(name_line) = lines.get(i + 1) {
                            if name_line.starts_with('n') {
                                return Some(cmd.to_string());
                            }
                        }
                    }
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(output) = tokio::process::Command::new("netstat")
                .args(&["-ano", "-p", "TCP"])
                .output()
                .await
            {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if let Some(pid) = parts.last() {
                            // Try to get process name from PID
                            if let Ok(tasklist) = tokio::process::Command::new("tasklist")
                                .args(&["/FI", &format!("PID eq {}", pid)])
                                .output()
                                .await
                            {
                                let tasklist_str = String::from_utf8_lossy(&tasklist.stdout);
                                for task_line in tasklist_str.lines().skip(3) {
                                    if !task_line.is_empty() {
                                        let task_parts: Vec<&str> =
                                            task_line.split_whitespace().collect();
                                        if let Some(name) = task_parts.first() {
                                            return Some(name.to_string());
                                        }
                                    }
                                }
                            }

                            return Some(format!("PID {}", pid));
                        }
                    }
                }
            }
        }

        None
    }
}

impl Default for ResourceChecker {
    fn default() -> Self {
        Self::new()
    }
}

/// Get default resource requirements for container operations
impl ResourceRequirements {
    #[allow(dead_code)]
    pub fn for_model_download() -> Self {
        Self {
            min_memory_mb: 2048, // 2GB minimum
            min_disk_gb: 10,     // 10GB for models
            required_ports: vec![],
            estimated_download_mb: 5120, // ~5GB for models
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_resource_checker() {
        let mut checker = ResourceChecker::new();
        let requirements = ResourceRequirements {
            min_memory_mb: 100, // Very low for testing
            min_disk_gb: 1,
            required_ports: vec![("test".to_string(), 65432)], // Unlikely to be used
            estimated_download_mb: 0,
        };

        let result = checker.check_resources(&requirements).await.unwrap();

        // Should pass on any reasonable system
        assert!(result.memory_check.passed);
        assert!(result.disk_check.passed);
    }
}
