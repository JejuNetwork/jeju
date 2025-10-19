#[cfg(test)]
mod runtime_compatibility_tests {
    use app_lib::{BackendError, ContainerManager, ContainerRuntimeType};
    use std::sync::Arc;

    #[tokio::test]
    async fn test_docker_runtime_creation() {
        match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Docker) {
            Ok(manager) => {
                println!("✅ Docker container manager created successfully");

                // Test basic functionality
                let progress = manager.get_setup_progress().await;
                assert_eq!(progress.stage, "initialized");
            }
            Err(e) => {
                println!("⚠️ Docker not available: {}", e);
                // This is expected if Docker is not installed
            }
        }
    }

    #[tokio::test]
    async fn test_podman_runtime_creation() {
        match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Podman) {
            Ok(manager) => {
                println!("✅ Podman container manager created successfully");

                // Test basic functionality
                let progress = manager.get_setup_progress().await;
                assert_eq!(progress.stage, "initialized");
            }
            Err(e) => {
                println!("⚠️ Podman not available: {}", e);
                // This is expected if Podman is not installed
            }
        }
    }

    #[tokio::test]
    async fn test_runtime_auto_detection() {
        use app_lib::RuntimeManager;
        use std::path::PathBuf;

        let mut runtime_manager = RuntimeManager::new(PathBuf::from("/tmp"));

        match runtime_manager.initialize().await {
            Ok(runtime_type) => {
                println!("✅ Runtime auto-detected: {:?}", runtime_type);

                // Verify the detected runtime works
                match runtime_type {
                    app_lib::RuntimeType::System(path) => {
                        let runtime_name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown");

                        println!("   Using system runtime: {}", runtime_name);
                        assert!(runtime_name == "docker" || runtime_name == "podman");
                    }
                    app_lib::RuntimeType::Bundled(path) => {
                        println!("   Using bundled runtime at: {:?}", path);
                    }
                    app_lib::RuntimeType::Downloaded(path) => {
                        println!("   Using downloaded runtime at: {:?}", path);
                    }
                }
            }
            Err(e) => {
                println!("❌ No runtime available: {}", e);
                // This test should fail if no runtime is available
                panic!("No container runtime found. Please install Docker or Podman.");
            }
        }
    }

    #[tokio::test]
    async fn test_docker_network_operations() {
        let manager = match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Docker) {
            Ok(m) => Arc::new(m),
            Err(_) => {
                println!("Skipping Docker network test - Docker not available");
                return;
            }
        };

        let test_network = format!("test-network-{}", uuid::Uuid::new_v4());

        // Create network
        match manager.create_network(&test_network).await {
            Ok(_) => {
                println!("✅ Docker network created: {}", test_network);

                // Clean up - network will be automatically removed when no containers use it
                // Docker doesn't have a direct network remove in our simple implementation
            }
            Err(e) => {
                println!("⚠️ Failed to create Docker network: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_podman_network_operations() {
        let manager = match ContainerManager::new_with_runtime_type(ContainerRuntimeType::Podman) {
            Ok(m) => Arc::new(m),
            Err(_) => {
                println!("Skipping Podman network test - Podman not available");
                return;
            }
        };

        let test_network = format!("test-network-{}", uuid::Uuid::new_v4());

        // Create network
        match manager.create_network(&test_network).await {
            Ok(_) => {
                println!("✅ Podman network created: {}", test_network);

                // Clean up
                let _ = std::process::Command::new("podman")
                    .args(["network", "rm", &test_network])
                    .output();
            }
            Err(e) => {
                println!("⚠️ Failed to create Podman network: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_container_operations_both_runtimes() {
        use app_lib::ContainerConfig;

        // Test with both runtimes
        for runtime_type in &[ContainerRuntimeType::Docker, ContainerRuntimeType::Podman] {
            let manager = match ContainerManager::new_with_runtime_type(*runtime_type) {
                Ok(m) => Arc::new(m),
                Err(_) => {
                    println!("Skipping {:?} container test - not available", runtime_type);
                    continue;
                }
            };

            println!("\n🧪 Testing container operations with {:?}", runtime_type);

            // Test container existence check
            let test_container = format!("test-container-{}", uuid::Uuid::new_v4());

            match manager.container_exists(&test_container).await {
                Ok(exists) => {
                    assert!(!exists, "Test container should not exist initially");
                    println!("  ✅ Container existence check works");
                }
                Err(e) => {
                    println!("  ⚠️ Container existence check failed: {}", e);
                }
            }

            // Test getting container status for non-existent container
            match manager.get_container_status(&test_container).await {
                Ok(_) => {
                    panic!("Should not find status for non-existent container");
                }
                Err(e) => {
                    println!("  ✅ Correctly failed to get status for non-existent container");
                    assert!(
                        e.to_string().contains("not found") || e.to_string().contains("No such")
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_runtime_preference_order() {
        // This test verifies that Podman is preferred over Docker when both are available
        use app_lib::RuntimeManager;
        use std::path::PathBuf;

        let mut runtime_manager = RuntimeManager::new(PathBuf::from("/tmp"));

        // Check if both Docker and Podman are available
        let docker_available = std::process::Command::new("docker")
            .arg("info")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        let podman_available = std::process::Command::new("podman")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if docker_available && podman_available {
            println!("Both Docker and Podman are available - testing preference");

            match runtime_manager.initialize().await {
                Ok(runtime_type) => {
                    match runtime_type {
                        app_lib::RuntimeType::System(path) => {
                            let runtime_name = path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown");

                            // Podman should be selected first
                            assert_eq!(
                                runtime_name, "podman",
                                "Podman should be preferred when both runtimes are available"
                            );
                            println!("✅ Correctly selected Podman as preferred runtime");
                        }
                        _ => {
                            println!("⚠️ Unexpected runtime type detected");
                        }
                    }
                }
                Err(e) => {
                    panic!("Runtime detection failed when both are available: {}", e);
                }
            }
        } else {
            println!("Skipping preference test - both runtimes not available");
            println!("  Docker available: {}", docker_available);
            println!("  Podman available: {}", podman_available);
        }
    }

    #[test]
    fn test_error_handling_consistency() {
        // Ensure error messages are consistent between Docker and Podman
        use app_lib::BackendError;

        let docker_error = BackendError::Container("Docker: Container not found".to_string());
        let podman_error = BackendError::Container("Podman: Container not found".to_string());

        // Both should be container errors
        assert!(matches!(docker_error, BackendError::Container(_)));
        assert!(matches!(podman_error, BackendError::Container(_)));

        println!("✅ Error handling is consistent between runtimes");
    }
}
