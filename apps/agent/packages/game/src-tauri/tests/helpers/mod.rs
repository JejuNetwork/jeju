use app_lib::{ContainerManager, ContainerRuntimeType};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct TestContext {
    pub container_manager: Arc<ContainerManager>,
    containers_to_cleanup: Arc<Mutex<Vec<String>>>,
}

#[allow(dead_code)]
impl TestContext {
    pub async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        // Try to create a container manager - prefer Podman
        let container_manager =
            match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Podman) {
                Ok(mgr) => Arc::new(mgr),
                Err(_) => {
                    println!("⚠️ Podman not available, trying Docker as fallback...");
                    match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Docker) {
                        Ok(mgr) => Arc::new(mgr),
                        Err(e) => {
                            println!("❌ No container runtime available: {}", e);
                            return Err(e.into());
                        }
                    }
                }
            };

        Ok(Self {
            container_manager,
            containers_to_cleanup: Arc::new(Mutex::new(Vec::new())),
        })
    }

    pub async fn register_for_cleanup(&self, container_name: String) {
        self.containers_to_cleanup.lock().await.push(container_name);
    }

    pub async fn cleanup(&self) {
        let containers = self.containers_to_cleanup.lock().await;
        for container_name in containers.iter() {
            println!("🧹 Cleaning up container: {}", container_name);
            // Try to stop and remove the container
            let _ = self.container_manager.stop_container(container_name).await;
            let _ = self
                .container_manager
                .remove_container(container_name)
                .await;
        }
    }

    /// Ensure a container is not running before starting a test
    pub async fn ensure_container_not_running(&self, container_name: &str) {
        // Check if container exists
        if let Ok(true) = self
            .container_manager
            .container_exists(container_name)
            .await
        {
            println!(
                "⚠️ Container {} already exists, cleaning up...",
                container_name
            );
            let _ = self.container_manager.stop_container(container_name).await;
            let _ = self
                .container_manager
                .remove_container(container_name)
                .await;
            // Wait a bit for cleanup to complete
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    }
}

impl Drop for TestContext {
    fn drop(&mut self) {
        // Note: Can't do async cleanup in Drop, but this is a reminder
        // to call cleanup() explicitly in tests
    }
}

/// Generate a unique container name for tests to avoid conflicts
#[allow(dead_code)]
pub fn unique_container_name(base: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}-test-{}", base, timestamp % 100000)
}
