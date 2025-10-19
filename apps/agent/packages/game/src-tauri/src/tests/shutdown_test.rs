#[cfg(test)]
mod shutdown_tests {
    use crate::backend::ContainerRuntimeType;
    use crate::backend::ContainerState;
    use crate::container::ContainerManager;
    use std::sync::Arc;
    use tracing::info;

    #[tokio::test]
    async fn test_shutdown_command_stops_containers() {
        // Initialize logging for tests
        let _ = tracing_subscriber::fmt::try_init();

        info!("🧪 Testing shutdown command");

        // Create a test container manager
        let container_manager = Arc::new(
            ContainerManager::new_with_runtime_type(ContainerRuntimeType::Podman)
                .expect("Failed to create container manager"),
        );

        // Get initial container statuses
        let initial_statuses = container_manager
            .get_all_statuses()
            .await
            .expect("Failed to get container statuses");

        info!("📦 Initial container statuses:");
        for status in &initial_statuses {
            info!("  {} - {:?}", status.name, status.state);
        }

        // Count running containers before shutdown
        let running_before = initial_statuses
            .iter()
            .filter(|s| s.state == ContainerState::Running)
            .count();

        info!("🏃 {} containers running before shutdown", running_before);

        if running_before == 0 {
            info!("⚠️ No containers running to test shutdown");
            return;
        }

        // Call stop_containers directly (simulating what shutdown_application does)
        container_manager
            .stop_containers()
            .await
            .expect("Failed to stop containers");

        // Give containers time to stop
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        // Get container statuses after shutdown
        let final_statuses = container_manager
            .get_all_statuses()
            .await
            .expect("Failed to get container statuses");

        info!("📦 Final container statuses:");
        for status in &final_statuses {
            info!("  {} - {:?}", status.name, status.state);
        }

        // Count running containers after shutdown
        let running_after = final_statuses
            .iter()
            .filter(|s| s.state == ContainerState::Running)
            .count();

        info!("🏃 {} containers running after shutdown", running_after);

        // Verify all containers are stopped
        assert_eq!(
            running_after, 0,
            "All containers should be stopped after shutdown"
        );

        info!("✅ Shutdown test passed - all containers stopped");
    }
}
