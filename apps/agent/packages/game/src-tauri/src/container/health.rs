use crate::backend::{
    BackendError, BackendResult, ContainerState, HealthCheckConfig, HealthStatus,
};
use crate::container::ContainerInfo;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio::time::{interval, Duration};
use tracing::{debug, error, info, warn};

pub struct HealthMonitor {
    checks: Arc<DashMap<String, HealthCheckTask>>,
}

struct HealthCheckTask {
    handle: JoinHandle<()>,
}

impl HealthMonitor {
    #[must_use]
    pub fn new() -> Self {
        Self {
            checks: Arc::new(DashMap::new()),
        }
    }

    pub async fn start_monitoring(
        &self,
        container_name: String,
        config: HealthCheckConfig,
        containers: Arc<DashMap<String, ContainerInfo>>,
    ) {
        // Stop existing monitoring for this container
        self.stop_monitoring(&container_name).await;

        let check_interval = Duration::from_secs(config.interval_seconds);
        let timeout = Duration::from_secs(config.timeout_seconds);
        let max_retries = config.retries;
        let command = config.command.clone();

        let container_name_clone = container_name.clone();
        let containers_clone = containers.clone();

        let handle = tokio::spawn(async move {
            let mut interval_timer = interval(check_interval);
            let mut consecutive_failures = 0;

            loop {
                interval_timer.tick().await;

                debug!(
                    "Performing health check for container: {}",
                    container_name_clone
                );

                match perform_health_check(&container_name_clone, &command, timeout).await {
                    Ok(is_healthy) => {
                        consecutive_failures = 0;
                        update_container_health(
                            &containers_clone,
                            &container_name_clone,
                            is_healthy,
                        );

                        if is_healthy {
                            debug!("Container {} is healthy", container_name_clone);
                        } else {
                            warn!("Container {} health check failed", container_name_clone);
                        }
                    }
                    Err(e) => {
                        consecutive_failures += 1;
                        warn!(
                            "Health check error for container {}: {} (failure {}/{})",
                            container_name_clone, e, consecutive_failures, max_retries
                        );

                        if consecutive_failures >= max_retries {
                            error!(
                                "Container {} marked as unhealthy after {} consecutive failures",
                                container_name_clone, consecutive_failures
                            );
                            update_container_health(
                                &containers_clone,
                                &container_name_clone,
                                false,
                            );
                        }
                    }
                }
            }
        });

        self.checks
            .insert(container_name.clone(), HealthCheckTask { handle });
        info!(
            "Started health monitoring for container: {}",
            container_name
        );
    }

    pub async fn stop_monitoring(&self, container_name: &str) {
        if let Some((_, task)) = self.checks.remove(container_name) {
            task.handle.abort();
            info!(
                "Stopped health monitoring for container: {}",
                container_name
            );
        }
    }

    pub async fn stop_all_monitoring(&self) {
        let container_names: Vec<String> = self
            .checks
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        for name in container_names {
            self.stop_monitoring(&name).await;
        }

        info!("Stopped all health monitoring");
    }
}

impl Default for HealthMonitor {
    fn default() -> Self {
        Self::new()
    }
}

async fn perform_health_check(
    container_name: &str,
    command: &[String],
    timeout: Duration,
) -> BackendResult<bool> {
    if command.is_empty() {
        return Err(BackendError::Container(
            "Empty health check command".to_string(),
        ));
    }

    let mut cmd = tokio::process::Command::new("podman"); // TODO: Make this configurable
    cmd.args(["exec", container_name])
        .args(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(output)) => {
            if !output.status.success() {
                // Log the failure details for debugging
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.is_empty() && !stderr.contains("connection refused") {
                    // Only log non-transient errors
                    debug!("Health check failed for {}: {}", container_name, stderr);
                }
            }
            Ok(output.status.success())
        }
        Ok(Err(e)) => {
            // Check if it's a transient error
            let error_string = e.to_string();
            if error_string.contains("No such container") || error_string.contains("is not running")
            {
                // Container is not running, this is expected during shutdown
                debug!("Container {} is not running: {}", container_name, e);
            } else {
                warn!(
                    "Health check execution failed for {}: {}",
                    container_name, e
                );
            }
            Err(BackendError::Container(format!(
                "Health check execution failed: {e}"
            )))
        }
        Err(_) => {
            debug!(
                "Health check timed out for {} after {:?}",
                container_name, timeout
            );
            Err(BackendError::Container(
                "Health check timed out".to_string(),
            ))
        }
    }
}

fn update_container_health(
    containers: &Arc<DashMap<String, ContainerInfo>>,
    container_name: &str,
    is_healthy: bool,
) {
    if let Some(mut container_info) = containers.get_mut(container_name) {
        container_info.status.health = if is_healthy {
            HealthStatus::Healthy
        } else {
            HealthStatus::Unhealthy
        };

        // Also update state if container was starting and is now healthy
        if container_info.status.state == ContainerState::Starting && is_healthy {
            container_info.status.state = ContainerState::Running;
        }
    }
}
