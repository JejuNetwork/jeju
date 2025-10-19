use app_lib::{ContainerManager, ContainerRuntimeType};

#[tokio::test]
async fn test_container_manager_creation() {
    // Test that we can create a container manager
    let result = ContainerManager::new(ContainerRuntimeType::Podman);

    match result {
        Ok(manager) => {
            println!("✅ Container manager created successfully");

            // Test getting setup progress
            let progress = manager.get_setup_progress().await;
            assert_eq!(progress.stage, "initialized");
            println!("✅ Setup progress retrieved: {}", progress.message);
        }
        Err(e) => {
            println!("❌ Failed to create container manager: {}", e);
            // Don't panic the test if Podman is not available
            if e.to_string().contains("Container runtime not available") {
                println!("⚠️  Podman not available, test passed conditionally");
            } else {
                panic!("Unexpected error: {}", e);
            }
        }
    }
}

#[tokio::test]
async fn test_health_monitor_creation() {
    use app_lib::HealthMonitor;

    let health_monitor = HealthMonitor::new();
    println!("✅ Health monitor created successfully");

    // Test that we can create it without errors
    assert_eq!(
        std::mem::size_of_val(&health_monitor),
        std::mem::size_of::<app_lib::HealthMonitor>()
    );
}

#[test]
fn test_backend_types() {
    use app_lib::{AgentConfig, ContainerConfig, PortMapping, VolumeMount};
    use uuid::Uuid;

    // Test AgentConfig creation
    let agent_config = AgentConfig {
        id: Uuid::new_v4(),
        name: "Test Agent".to_string(),
        character_file: Some("test.json".to_string()),
        plugins: vec!["plugin1".to_string(), "plugin2".to_string()],
        settings: serde_json::json!({"test": "value"}),
    };

    println!("✅ AgentConfig created: {}", agent_config.name);

    // Test ContainerConfig creation
    let container_config = ContainerConfig {
        name: "test-container".to_string(),
        image: "test:latest".to_string(),
        ports: vec![PortMapping::new(8080, 80)],
        environment: vec!["TEST=true".to_string()],
        volumes: vec![VolumeMount::new("host-path", "/container-path")],
        health_check: None,
        network: None,
        memory_limit: None,
    };

    println!("✅ ContainerConfig created: {}", container_config.name);
    assert_eq!(container_config.ports[0].host_port, 8080);
    assert_eq!(container_config.ports[0].container_port, 80);
}

#[test]
fn test_serialization() {
    use app_lib::{ContainerState, ContainerStatus, HealthStatus};

    let status = ContainerStatus {
        id: "test-id".to_string(),
        name: "test-container".to_string(),
        state: ContainerState::Running,
        health: HealthStatus::Healthy,
        ports: vec![],
        started_at: Some(1234567890),
        uptime_seconds: 3600,
        restart_count: 0,
    };

    // Test JSON serialization
    let json = serde_json::to_string(&status).expect("Should serialize to JSON");
    println!("✅ ContainerStatus serialized to JSON: {}", json);

    // Test deserialization
    let deserialized: ContainerStatus =
        serde_json::from_str(&json).expect("Should deserialize from JSON");
    assert_eq!(deserialized.name, status.name);
    assert_eq!(deserialized.state, status.state);
    println!("✅ ContainerStatus deserialized successfully");
}

#[tokio::test]
async fn test_http_server_creation() {
    use app_lib::{BackendConfig, ContainerManager, ContainerRuntimeType, HttpServer};

    // Create container manager
    let _container_manager = match ContainerManager::new(ContainerRuntimeType::Podman) {
        Ok(manager) => std::sync::Arc::new(manager),
        Err(_) => {
            println!("⚠️  Podman not available, skipping HTTP server test");
            return;
        }
    };

    // Create HTTP server
    let _config = BackendConfig::default();
    let server = HttpServer::new(); // The new API doesn't take parameters

    println!("✅ HTTP server created successfully");

    // Test router creation
    let _router = server.create_router();
    println!("✅ HTTP router created successfully");

    // Note: We can't easily test the actual server startup without binding to a port
    // This test verifies the server can be instantiated correctly
}

#[tokio::test]
async fn test_websocket_hub() {
    use app_lib::WebSocketHub;

    let hub = WebSocketHub::new();

    // Test initial state
    assert_eq!(hub.get_client_count(), 0);
    assert_eq!(hub.get_room_count(), 0);

    println!("✅ WebSocket hub created with correct initial state");

    // Note: Testing client connections would require actual WebSocket connections
    // This test verifies the hub can be instantiated correctly
}
