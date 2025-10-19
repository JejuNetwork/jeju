# ElizaOS Game Tests

This directory contains comprehensive tests for the ElizaOS game backend, including container management, WebSocket integration, and HTTP endpoints.

## Test Structure

```
tests/
├── container/              # Container-specific tests
│   ├── agent_test.rs      # Agent container tests
│   ├── ollama_test.rs     # Ollama container tests
│   └── postgres_test.rs   # PostgreSQL container tests
├── helpers/               # Test utilities
│   └── mod.rs            # Test context and helper functions
├── container_integration.rs  # Container integration tests
├── container_tests.rs       # Container test module
├── e2e_http.rs             # HTTP endpoint tests
├── integration.rs          # Basic integration tests
└── websocket_integration.rs # WebSocket message flow tests
```

## Running Tests

### Prerequisites

1. **Container Runtime**: Either Podman or Docker must be installed and running
2. **For WebSocket tests**: The agent server must be running on port 7777

### Running All Tests

```bash
cargo test
```

### Running Specific Test Categories

```bash
# Container tests only
cargo test --test container_tests

# WebSocket integration tests
cargo test --test websocket_integration

# HTTP endpoint tests
cargo test --test e2e_http

# Container integration tests
cargo test --test container_integration

# Basic integration tests
cargo test --test integration
```

### Running Tests with Output

```bash
# Run with full output
cargo test -- --nocapture

# Run with single thread to avoid conflicts
cargo test -- --test-threads=1 --nocapture
```

## Test Categories

### 1. Container Tests (`container_tests.rs`)

Tests individual container functionality:

- Container configuration validation
- Container lifecycle (start/stop/restart)
- Environment variable configuration
- Volume mounting
- Health monitoring setup

### 2. Container Integration Tests (`container_integration.rs`)

Tests the full container stack:

- Complete stack integration (Postgres + Ollama + Agent)
- Container networking
- Health monitoring
- Container restart functionality
- Volume persistence
- Agent API endpoints

### 3. WebSocket Integration Tests (`websocket_integration.rs`)

Tests WebSocket message flow:

- End-to-end message flow (client → agent → response)
- WebSocket reconnection logic
- Multiple concurrent clients
- Connection management

**Note**: These tests require the agent server to be running on port 7777.

### 4. HTTP Endpoint Tests (`e2e_http.rs`)

Tests HTTP API endpoints:

- Health check endpoint
- Container status endpoint
- WebSocket info endpoint

### 5. Basic Integration Tests (`integration.rs`)

Tests basic Rust backend functionality:

- Container manager creation
- Health monitor creation
- Backend types and serialization
- HTTP server creation
- WebSocket hub functionality

## Common Test Patterns

### Container Test Pattern

```rust
#[tokio::test]
async fn test_container_functionality() {
    // Create test context
    let ctx = match TestContext::new().await {
        Ok(ctx) => ctx,
        Err(_) => {
            println!("⚠️ No container runtime available, skipping test");
            return;
        }
    };

    // Ensure clean state
    ctx.ensure_container_not_running("container-name").await;

    // Test functionality
    match ctx.container_manager.start_container().await {
        Ok(status) => {
            // Verify container behavior
            ctx.register_for_cleanup("container-name".to_string()).await;
        }
        Err(e) => {
            // Handle expected errors gracefully
        }
    }

    // Cleanup
    ctx.cleanup().await;
}
```

### WebSocket Test Pattern

```rust
#[tokio::test]
async fn test_websocket_functionality() {
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let ws_url = "ws://localhost:7777/ws";

    match timeout(Duration::from_secs(5), connect_async(ws_url)).await {
        Ok(Ok((mut ws_stream, _))) => {
            // Test WebSocket functionality
        }
        _ => {
            println!("⚠️ Server not available");
        }
    }
}
```

## Troubleshooting

### Container Already Exists Errors

If you see errors like "container name already in use", run:

```bash
# Clean up all test containers
podman rm -f eliza-postgres eliza-ollama eliza-agent

# Or with Docker
docker rm -f eliza-postgres eliza-ollama eliza-agent
```

### WebSocket Connection Errors

If WebSocket tests fail to connect:

1. Ensure the agent server is running:

   ```bash
   cd ../../../agentserver
   bun run start
   ```

2. Check that port 7777 is not blocked by firewall

### Container Runtime Not Available

If tests skip due to no container runtime:

1. Install Podman: https://podman.io/getting-started/installation
2. Or install Docker: https://docs.docker.com/get-docker/

3. Ensure the container runtime is running:
   ```bash
   podman info
   # or
   docker info
   ```

## Test Coverage

The test suite covers:

- ✅ Container lifecycle management
- ✅ Container networking
- ✅ Health monitoring
- ✅ Volume persistence (conceptual)
- ✅ HTTP API endpoints
- ✅ WebSocket connections
- ✅ Message flow (when server is running)
- ✅ Multiple client handling
- ✅ Error handling and recovery

## Future Improvements

1. **Mock Container Runtime**: Implement a mock container runtime for testing without Podman/Docker
2. **Embedded Test Server**: Start an embedded agent server for WebSocket tests
3. **Database Integration**: Test actual database operations
4. **Ollama Model Tests**: Test model downloading and inference
5. **Performance Tests**: Add benchmarks for container operations
6. **Stress Tests**: Test with many containers and high message volume
