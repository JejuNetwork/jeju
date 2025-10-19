use crate::backend::{BackendError, BackendResult, ContainerConfig};
use std::path::Path;
use tracing::warn;

#[derive(Clone)]
pub struct DockerClient {
    docker_path: String,
}

impl Default for DockerClient {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerClient {
    pub fn new() -> Self {
        Self {
            docker_path: "docker".to_string(),
        }
    }

    pub fn with_path(path: String) -> Self {
        Self { docker_path: path }
    }

    pub fn get_path(&self) -> &str {
        &self.docker_path
    }

    pub async fn create_network(&self, network_name: &str) -> BackendResult<()> {
        // Check if network already exists
        let check_output = std::process::Command::new(&self.docker_path)
            .args(["network", "ls", "--format", "{{.Name}}"])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to list networks: {e}")))?;

        let networks = String::from_utf8_lossy(&check_output.stdout);
        if networks.lines().any(|n| n.trim() == network_name) {
            return Ok(());
        }

        // Create the network
        let output = std::process::Command::new(&self.docker_path)
            .args(["network", "create", network_name])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to create network: {e}")))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(BackendError::Container(format!(
                "Failed to create network {network_name}: {error_msg}"
            )));
        }

        Ok(())
    }

    pub async fn is_available(&self) -> BackendResult<bool> {
        // Check if Docker is available by running 'docker version'
        match std::process::Command::new(&self.docker_path)
            .arg("version")
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    Ok(true)
                } else {
                    warn!(
                        "Docker command failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                    Ok(false)
                }
            }
            Err(e) => {
                warn!("Docker not available: {}", e);
                Ok(false)
            }
        }
    }

    pub async fn start_container(&self, config: &ContainerConfig) -> BackendResult<String> {
        warn!("Docker implementation is basic - using simple docker run command");

        let mut cmd = std::process::Command::new(&self.docker_path);
        cmd.args(["run", "-d", "--name", &config.name]);

        // Add port mappings
        for port in &config.ports {
            cmd.args(["-p", &format!("{}:{}", port.host_port, port.container_port)]);
        }

        // Add environment variables
        for env in &config.environment {
            cmd.args(["-e", env]);
        }

        // Add volumes
        for volume in &config.volumes {
            cmd.args([
                "-v",
                &format!("{}:{}", volume.host_path, volume.container_path),
            ]);
        }

        // Add container to network for inter-container communication
        if let Some(network) = &config.network {
            cmd.args(["--network", network]);
        }

        // Add memory limit if specified
        if let Some(memory_limit) = &config.memory_limit {
            cmd.args(["-m", memory_limit]);
        }

        cmd.arg(&config.image);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    Ok(container_id)
                } else {
                    Err(BackendError::Container(format!(
                        "Failed to start Docker container: {}",
                        String::from_utf8_lossy(&output.stderr)
                    )))
                }
            }
            Err(e) => Err(BackendError::Container(format!(
                "Docker command failed: {e}"
            ))),
        }
    }

    pub async fn stop_container(&self, name: &str) -> BackendResult<()> {
        match std::process::Command::new(&self.docker_path)
            .args(["stop", name])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(BackendError::Container(format!(
                        "Failed to stop Docker container: {}",
                        String::from_utf8_lossy(&output.stderr)
                    )))
                }
            }
            Err(e) => Err(BackendError::Container(format!(
                "Docker command failed: {e}"
            ))),
        }
    }

    pub async fn remove_container(&self, name: &str) -> BackendResult<()> {
        match std::process::Command::new(&self.docker_path)
            .args(["rm", "-f", name])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(BackendError::Container(format!(
                        "Failed to remove Docker container: {}",
                        String::from_utf8_lossy(&output.stderr)
                    )))
                }
            }
            Err(e) => Err(BackendError::Container(format!(
                "Docker command failed: {e}"
            ))),
        }
    }

    pub async fn load_image(&self, image_path: &Path) -> BackendResult<()> {
        let output = std::process::Command::new(&self.docker_path)
            .args(["load", "-i", &image_path.to_string_lossy()])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to load Docker image: {e}")))?;

        if output.status.success() {
            Ok(())
        } else {
            Err(BackendError::Container(format!(
                "Failed to load Docker image: {}",
                String::from_utf8_lossy(&output.stderr)
            )))
        }
    }

    pub async fn image_exists(&self, image_name: &str) -> BackendResult<bool> {
        match std::process::Command::new(&self.docker_path)
            .args(["images", "-q", image_name])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    let images_list = String::from_utf8_lossy(&output.stdout);
                    Ok(!images_list.trim().is_empty())
                } else {
                    Ok(false)
                }
            }
            Err(_) => Ok(false),
        }
    }

    pub async fn get_container_status(
        &self,
        container_name: &str,
    ) -> BackendResult<crate::backend::ContainerStatus> {
        let output = std::process::Command::new(&self.docker_path)
            .args([
                "ps",
                "-a",
                "--format",
                "{{.ID}}:{{.Names}}:{{.State}}:{{.Status}}",
                "--filter",
                &format!("name={}", container_name),
            ])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to get container status: {e}")))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(BackendError::Container(format!(
                "Failed to get container status: {error_msg}"
            )));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = output_str.trim().lines().collect();

        if lines.is_empty() {
            return Err(BackendError::Container(format!(
                "Container {} not found",
                container_name
            )));
        }

        // Parse the first matching line
        let line = lines[0];
        let parts: Vec<&str> = line.split(':').collect();

        if parts.len() < 4 {
            return Err(BackendError::Container(format!(
                "Invalid container status format: {}",
                line
            )));
        }

        let state = match parts[2] {
            "running" => crate::backend::ContainerState::Running,
            "paused" => crate::backend::ContainerState::Stopped,
            "exited" => crate::backend::ContainerState::Stopped,
            "created" => crate::backend::ContainerState::Starting,
            _ => crate::backend::ContainerState::Unknown,
        };

        let health = match state {
            crate::backend::ContainerState::Running => crate::backend::HealthStatus::Healthy,
            _ => crate::backend::HealthStatus::Unknown,
        };

        Ok(crate::backend::ContainerStatus {
            id: parts[0].to_string(),
            name: parts[1].to_string(),
            state,
            health,
            ports: vec![],
            started_at: None,
            uptime_seconds: 0,
            restart_count: 0,
        })
    }

    pub async fn list_containers_by_pattern(&self, pattern: &str) -> BackendResult<Vec<String>> {
        let output = std::process::Command::new(&self.docker_path)
            .args([
                "ps",
                "-a",
                "--format",
                "{{.Names}}",
                "--filter",
                &format!("name={}", pattern),
            ])
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to list containers: {e}")))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(BackendError::Container(format!(
                "Failed to list containers: {error_msg}"
            )));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let names: Vec<String> = output_str
            .lines()
            .filter(|line| !line.is_empty())
            .map(|s| s.to_string())
            .collect();

        Ok(names)
    }

    pub async fn container_exists(&self, container_name: &str) -> BackendResult<bool> {
        match std::process::Command::new(&self.docker_path)
            .args(["container", "inspect", container_name])
            .output()
        {
            Ok(output) => Ok(output.status.success()),
            Err(e) => Err(BackendError::Container(format!(
                "Failed to check if container exists: {}",
                e
            ))),
        }
    }

    pub async fn is_container_running(&self, container_name: &str) -> BackendResult<bool> {
        match std::process::Command::new(&self.docker_path)
            .args(["ps", "-q", "-f", &format!("name={}", container_name)])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    let container_list = String::from_utf8_lossy(&output.stdout);
                    Ok(!container_list.trim().is_empty())
                } else {
                    Ok(false)
                }
            }
            Err(e) => Err(BackendError::Container(format!(
                "Failed to check if container is running: {}",
                e
            ))),
        }
    }

    /// Execute a command inside a running container
    pub async fn exec(
        &self,
        container_name: &str,
        command: &[&str],
    ) -> BackendResult<std::process::Output> {
        let mut args = vec!["exec", container_name];
        args.extend(command);

        let output = tokio::process::Command::new(&self.docker_path)
            .args(&args)
            .output()
            .await
            .map_err(|e| {
                BackendError::Container(format!(
                    "Failed to exec in container {}: {}",
                    container_name, e
                ))
            })?;

        Ok(output)
    }

    pub async fn start_existing_container(&self, container_name: &str) -> BackendResult<()> {
        match std::process::Command::new(&self.docker_path)
            .args(["start", container_name])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    Ok(())
                } else {
                    // Check if container doesn't exist
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if stderr.contains("No such container") {
                        Err(BackendError::Container(format!(
                            "Container {} not found",
                            container_name
                        )))
                    } else {
                        Err(BackendError::Container(format!(
                            "Failed to start container {}: {}",
                            container_name, stderr
                        )))
                    }
                }
            }
            Err(e) => Err(BackendError::Container(format!(
                "Docker command failed: {e}"
            ))),
        }
    }
}
