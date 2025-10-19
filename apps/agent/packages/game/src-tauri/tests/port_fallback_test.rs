#[cfg(test)]
mod port_fallback_tests {
    use app_lib::{ContainerManager, ContainerRuntimeType, PortConfig};

    #[tokio::test]
    async fn test_port_config_find_available_ports() {
        // Test that PortConfig can find available ports
        let config = PortConfig::find_available_ports().await;

        // The ports should be valid port numbers
        assert!(config.postgres_port >= 1024 && config.postgres_port <= 65535);
        assert!(config.ollama_port >= 1024 && config.ollama_port <= 65535);
        assert!(config.agent_port >= 1024 && config.agent_port <= 65535);

        println!("Found available ports:");
        println!("  PostgreSQL: {}", config.postgres_port);
        println!("  Ollama: {}", config.ollama_port);
        println!("  Agent: {}", config.agent_port);
    }

    #[tokio::test]
    async fn test_container_manager_port_config() {
        // Create a container manager and verify it initializes with port config
        let manager = ContainerManager::new_with_runtime_type(ContainerRuntimeType::Podman)
            .expect("Failed to create container manager");

        let port_config = manager.get_port_config().await;

        // Default configuration should use standard ports
        assert_eq!(port_config.postgres_port, 5432);
        assert_eq!(port_config.ollama_port, 11434);
        assert_eq!(port_config.agent_port, 7777);
    }

    #[tokio::test]
    async fn test_port_fallback_when_in_use() {
        use std::net::TcpListener;

        // Bind to port 5432 to simulate it being in use
        let _listener = TcpListener::bind("127.0.0.1:5432");

        // Now check if PortConfig finds an alternative
        let config = PortConfig::find_available_ports().await;

        // Should not use 5432 if our listener is holding it
        if _listener.is_ok() {
            assert_ne!(config.postgres_port, 5432);
            println!(
                "Port 5432 was in use, alternative port selected: {}",
                config.postgres_port
            );
        }
    }

    #[test]
    fn test_is_port_available() {
        use app_lib::is_port_available;
        use std::net::TcpListener;

        // Find a random available port
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        // Port should be unavailable while we're listening
        assert!(!is_port_available(port));

        // Drop the listener
        drop(listener);

        // Give the OS a moment to release the port
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Now it should be available
        assert!(is_port_available(port));
    }
}
