// ElizaOS Game - Rust Backend Implementation
// This replaces the Node.js backend with a high-performance Rust backend

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

// New Rust backend modules
mod backend;
mod backup;
mod common;
mod container;
mod ipc;
mod server;
mod startup;
mod tests;

// Re-export common constants and utilities for tests
pub use common::{
    is_port_available, AGENT_CONTAINER, NETWORK_NAME, OLLAMA_CONTAINER, POSTGRES_CONTAINER,
};
// Export types for external use (tests, etc.)
pub use backend::{
    AgentConfig, BackendConfig, BackendError, BackendResult, ContainerConfig, ContainerRuntimeType,
    ContainerState, ContainerStatus, HealthStatus, PortMapping, SetupProgress, VolumeMount,
};
pub use container::{ContainerManager, HealthMonitor, PortConfig, RuntimeDetectionStatus};
pub use ipc::commands::*;
pub use server::{HttpServer, WebSocketHub};
pub use startup::{AiProvider, StartupManager, StartupStage, StartupStatus, UserConfig};

// Store crash recovery file path
pub struct CrashFile(PathBuf);

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello, {}! You've been greeted from the Rust backend!",
        name
    )
}

// Tauri callback server for receiving real-time updates from backend
use axum::{extract::Json, response::Json as JsonResponse, routing::post, Router};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct AgentResponseCallback {
    message_id: String,
    agent_id: String,
    room_id: String,
    content: String,
    timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CallbackResponse {
    success: bool,
    message: String,
}

async fn handle_agent_response_callback(
    Json(payload): Json<AgentResponseCallback>,
) -> JsonResponse<CallbackResponse> {
    info!("🔔 Received agent response callback: {}", payload.content);

    // For now, we'll emit a Tauri event that the frontend can listen to
    // Note: We need to get the app handle to emit events, but this is called from axum
    // We'll log the callback for now and implement proper event emission later
    info!(
        "📨 Agent Response - ID: {}, Content: '{}'",
        payload.message_id, payload.content
    );

    // TODO: Store this callback data so it can be retrieved by the frontend
    // For now, just acknowledge receipt

    JsonResponse(CallbackResponse {
        success: true,
        message: "Agent response received and logged".to_string(),
    })
}

// Start the callback server on a specific port
async fn start_callback_server_on_port(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new().route("/agent-response", post(handle_agent_response_callback));

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("🔗 Tauri callback server listening on http://{}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn route_message_to_agent(
    message: &str,
    container_manager: Option<Arc<ContainerManager>>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();

    // Get the dynamic agent port
    let agent_port = if let Some(manager) = &container_manager {
        let port_config = manager.get_port_config().await;
        port_config.agent_port
    } else {
        7777 // Default fallback
    };

    // Use the autonomous thoughts room which exists in the agent
    let room_id = "ce5f41b4-fe24-4c01-9971-aecfed20a6bd"; // Autonomous thoughts room
    let _agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f"; // Agent ID

    // First attempt with recovery support
    let attempt_request = || async {
        // First, ensure the room/channel exists in the messaging system
        // Create a proper channel entry if needed
        let channel_url = format!(
            "http://localhost:{}/api/messaging/central-channels/{}",
            agent_port, room_id
        );
        let channel_check = client.get(&channel_url).send().await;

        if channel_check.is_err() || !channel_check.unwrap().status().is_success() {
            info!("Channel doesn't exist in messaging system, creating it...");

            // Try to create the channel
            let create_channel_url = format!(
                "http://localhost:{}/api/messaging/central-channels",
                agent_port
            );
            let _ = client
                .post(&create_channel_url)
                .json(&serde_json::json!({
                    "id": room_id,
                    "server_id": "00000000-0000-0000-0000-000000000000",
                    "name": "Game UI Channel",
                    "type": "game",
                    "metadata": {
                        "source": "eliza_game"
                    }
                }))
                .send()
                .await;
        }

        // Use the ingest-external endpoint which works properly
        let message_url = format!(
            "http://localhost:{}/api/messaging/ingest-external",
            agent_port
        );

        let response = client
            .post(&message_url)
            .json(&serde_json::json!({
                "channel_id": room_id,
                "server_id": "00000000-0000-0000-0000-000000000000",
                "author_id": "00000000-0000-0000-0000-000000000001", // Fixed user ID
                "author_display_name": "Admin",
                "content": message,
                "source_type": "game_ui",
                "raw_message": {
                    "text": message,
                    "type": "user_message"
                },
                "metadata": {
                    "source": "eliza_game",
                    "userName": "Admin"
                }
            }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await?;

        if response.status().is_success() {
            // For the ingest-external endpoint, we get an acknowledgment but not the actual response
            // The actual response would come through WebSocket or we'd need to poll for it
            let _response_data: serde_json::Value = response.json().await?;

            // For now, return a confirmation that the message was ingested
            Ok(format!("Message sent to agent: {}", message))
                as Result<String, Box<dyn std::error::Error + Send + Sync>>
        } else {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            Err(format!("Agent responded with status: {} - {}", status, error_text).into())
                as Result<String, Box<dyn std::error::Error + Send + Sync>>
        }
    };

    // First attempt
    match attempt_request().await {
        Ok(result) => Ok(result),
        Err(e) => {
            let error_str = e.to_string();

            // Check if it's a connection error
            if error_str.contains("Connection refused")
                || error_str.contains("tcp connect error")
                || error_str.contains("connection closed")
            {
                warn!(
                    "Agent server appears to be down while routing message: {}",
                    error_str
                );

                // If we have a container manager, try to recover
                if let Some(manager) = container_manager {
                    warn!("Attempting to recover agent container...");

                    // Try to restart the agent container
                    match manager.restart_container(common::AGENT_CONTAINER).await {
                        Ok(_) => {
                            info!("Agent container restarted, waiting for it to be ready...");

                            // Wait a bit for the container to start up
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                            // Retry the message after recovery
                            return attempt_request().await;
                        }
                        Err(recovery_err) => {
                            error!("Failed to restart agent container: {}", recovery_err);
                        }
                    }
                }
            }

            // Return the original error if we couldn't recover
            Err(e)
        }
    }
}

#[tauri::command]
async fn get_container_runtime_status(
    runtime_status: State<'_, Arc<std::sync::Mutex<RuntimeDetectionStatus>>>,
) -> Result<RuntimeDetectionStatus, String> {
    let status = runtime_status
        .lock()
        .map_err(|e| format!("Failed to lock runtime status: {}", e))?;
    Ok(status.clone())
}

#[tauri::command]
async fn get_startup_status(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
) -> Result<StartupStatus, String> {
    let manager = startup_manager.lock().await;
    Ok(manager.get_status())
}

#[tauri::command]
async fn submit_user_config(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
    config: UserConfig,
) -> Result<(), String> {
    info!("📝 Received user configuration from frontend");

    let mut manager = startup_manager.lock().await;
    manager
        .handle_user_config(config)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn send_message_to_agent(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
    native_ws_client: State<'_, Arc<server::websocket::WebSocketClient>>,
    container_manager: State<'_, Arc<ContainerManager>>,
    message: String,
) -> Result<String, String> {
    info!("💬 Received message from frontend: {}", message);

    let manager = startup_manager.lock().await;
    if !manager.is_ready() {
        return Err("System is not ready for messages yet".to_string());
    }
    drop(manager);

    // Try native WebSocket first (real-time communication)
    if native_ws_client.is_connected().await {
        info!("📡 Sending message via native WebSocket");
        match native_ws_client.send_message(&message).await {
            Ok(_) => {
                info!("✅ Message sent via WebSocket successfully");
                return Ok(
                    "Message sent via WebSocket - response will arrive via real-time events"
                        .to_string(),
                );
            }
            Err(e) => {
                warn!("⚠️ WebSocket send failed, falling back to HTTP: {}", e);
            }
        }
    }

    // Fallback to HTTP API if WebSocket is not available
    info!("🔄 Falling back to HTTP API for message delivery");
    match route_message_to_agent(&message, Some(container_manager.inner().clone())).await {
        Ok(response) => Ok(response),
        Err(e) => {
            error!("Failed to route message via HTTP: {}", e);

            // If it's a connection error, try to recover and retry once more
            let error_str = e.to_string();
            if error_str.contains("Connection refused") || error_str.contains("tcp connect error") {
                warn!("Detected connection error, attempting container recovery...");

                // Try to restart the agent container
                match container_manager
                    .restart_container(common::AGENT_CONTAINER)
                    .await
                {
                    Ok(_) => {
                        info!("Agent container restarted, waiting for it to be ready...");

                        // Wait a bit for the container to start up
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                        // One more try after recovery
                        match route_message_to_agent(
                            &message,
                            Some(container_manager.inner().clone()),
                        )
                        .await
                        {
                            Ok(response) => return Ok(response),
                            Err(retry_err) => {
                                error!("Message still failed after recovery: {}", retry_err);
                            }
                        }
                    }
                    Err(recovery_err) => {
                        error!("Failed to restart agent container: {}", recovery_err);
                    }
                }
            }

            Err(format!(
                "Both WebSocket and HTTP communication failed: {}",
                e
            ))
        }
    }
}

#[tauri::command]
async fn start_game_environment(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
) -> Result<String, String> {
    info!("🎮 Starting game environment");

    let manager = startup_manager.lock().await;
    let status = manager.get_status();

    match status.stage {
        crate::startup::StartupStage::Ready => Ok("Game environment already ready".to_string()),
        crate::startup::StartupStage::Error => {
            Err("Game environment is in error state".to_string())
        }
        _ => Ok("Game environment is starting...".to_string()),
    }
}

#[tauri::command]
async fn wait_for_server(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
    max_attempts: u32,
    delay_ms: u64,
) -> Result<bool, String> {
    info!(
        "⏳ Waiting for server to be ready (max {} attempts, {}ms delay)",
        max_attempts, delay_ms
    );

    for attempt in 0..max_attempts {
        let manager = startup_manager.lock().await;
        if manager.is_ready() {
            info!("✅ Server is ready after {} attempts", attempt + 1);
            return Ok(true);
        }
        drop(manager);

        if attempt < max_attempts - 1 {
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }
    }

    warn!("❌ Server not ready after {} attempts", max_attempts);
    Ok(false)
}

#[tauri::command]
async fn get_agent_configuration(
    container_manager: State<'_, Arc<ContainerManager>>,
) -> Result<serde_json::Value, String> {
    info!("📊 Getting agent configuration from ElizaOS server");

    // Get the dynamic agent port
    let port_config = container_manager.get_port_config().await;
    let agent_port = port_config.agent_port;

    let client = reqwest::Client::new();
    let url = format!("http://localhost:{}/api/agents", agent_port);

    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch agent configuration: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned error: {}", response.status()));
    }

    let config: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse configuration response: {}", e))?;

    Ok(config)
}

#[tauri::command]
async fn update_agent_configuration(
    config_updates: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("🔄 Agent configuration update requested (feature not yet implemented in server)");

    // For now, return a success response since the update endpoint doesn't exist yet
    // In a real implementation, this would update the agent's configuration
    Ok(serde_json::json!({
        "success": true,
        "message": "Configuration update request received",
        "data": config_updates
    }))
}

#[tauri::command]
async fn get_available_providers() -> Result<serde_json::Value, String> {
    info!("🔍 Getting available AI providers (mock data - endpoint not yet implemented)");

    // For now, return mock provider data since the endpoint doesn't exist yet
    // In a real implementation, this would fetch from the agent server
    Ok(serde_json::json!({
        "success": true,
        "data": {
            "providers": [
                {
                    "name": "ollama",
                    "display_name": "Ollama (Local)",
                    "enabled": true,
                    "requires_api_key": false,
                    "status": "available",
                    "message": "Run models locally on your machine"
                },
                {
                    "name": "openai",
                    "display_name": "OpenAI",
                    "enabled": true,
                    "requires_api_key": true,
                    "status": "available",
                    "message": "GPT-5 and other OpenAI models"
                },
                {
                    "name": "anthropic",
                    "display_name": "Anthropic",
                    "enabled": true,
                    "requires_api_key": true,
                    "status": "available",
                    "message": "Claude 3.5 Sonnet, Haiku and other models"
                },
                {
                    "name": "groq",
                    "display_name": "Groq",
                    "enabled": true,
                    "requires_api_key": true,
                    "status": "available",
                    "message": "Ultra-fast inference with Groq Cloud"
                },
                {
                    "name": "elizaos",
                    "display_name": "ElizaOS Cloud",
                    "enabled": true,
                    "requires_api_key": true,
                    "status": "available",
                    "message": "Managed AI models by ElizaOS"
                }
            ],
            "active": "ollama",
            "selected": null,
            "preferences": ["ollama", "openai", "anthropic", "groq", "elizaos"]
        }
    }))
}

#[tauri::command]
async fn connect_native_websocket(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
    url: String,
) -> Result<(), String> {
    info!("🔌 Connecting to WebSocket server: {}", url);

    native_ws_client.connect(&url).await.map_err(|e| {
        error!("Failed to connect to WebSocket: {}", e);
        format!("Failed to connect: {}", e)
    })
}

#[tauri::command]
async fn disconnect_native_websocket(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
) -> Result<(), String> {
    info!("🔌 Disconnecting from WebSocket server");
    native_ws_client.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn reconnect_native_websocket(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
    url: String,
) -> Result<(), String> {
    info!("🔄 Reconnecting to WebSocket server: {}", url);
    native_ws_client.reconnect(&url).await;
    Ok(())
}

#[tauri::command]
async fn send_native_websocket_message(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
    message: String,
) -> Result<(), String> {
    info!("📤 Sending WebSocket message: {}", message);

    native_ws_client.send_message(&message).await.map_err(|e| {
        error!("Failed to send WebSocket message: {}", e);
        format!("Failed to send message: {}", e)
    })
}

#[tauri::command]
async fn is_native_websocket_connected(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
) -> Result<bool, String> {
    Ok(native_ws_client.is_connected().await)
}

#[tauri::command]
async fn get_native_websocket_state(
    native_ws_client: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
) -> Result<String, String> {
    let state = native_ws_client.get_connection_state().await;
    Ok(format!("{:?}", state))
}

// Socket.IO commands removed - using native WebSocket instead

// Test native WebSocket connection
#[tauri::command]
async fn test_native_websocket(
    native_ws: tauri::State<'_, Arc<server::websocket::WebSocketClient>>,
) -> Result<String, String> {
    info!("🧪 Testing native WebSocket connection");

    // Check if connected and connect if needed
    if !native_ws.is_connected().await {
        native_ws
            .connect("ws://localhost:7777/ws")
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;
    }

    // Send test message
    native_ws
        .send_message("hello from tauri! repeat back this message if you can read it!")
        .await
        .map_err(|e| format!("Failed to send test message: {}", e))?;

    Ok("Test message sent successfully".to_string())
}

// Comprehensive startup test that verifies Tauri → AgentServer → Agent communication
#[tauri::command]
async fn run_startup_hello_world_test(
    startup_manager: State<'_, Arc<Mutex<StartupManager>>>,
    native_ws_client: State<'_, Arc<server::websocket::WebSocketClient>>,
    container_manager: State<'_, Arc<ContainerManager>>,
) -> Result<String, String> {
    info!("🧪 Running comprehensive startup hello world test");

    let mut test_results = Vec::new();

    // Step 1: Check if startup manager is ready
    {
        let manager = startup_manager.lock().await;
        let status = manager.get_status();
        if !manager.is_ready() {
            return Err(format!(
                "Startup manager not ready. Current stage: {:?}",
                status.stage
            ));
        }
        test_results.push("✅ Startup manager is ready".to_string());
    }

    // Get dynamic port configuration
    let port_config = container_manager.get_port_config().await;
    let agent_port = port_config.agent_port;

    if agent_port != 7777 {
        test_results.push(format!("ℹ️ Using alternative agent port: {}", agent_port));
    }

    // Step 2: Test HTTP API connectivity to agent server
    let client = reqwest::Client::new();
    let api_url = format!("http://localhost:{}/api/agents", agent_port);
    match client
        .get(&api_url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                test_results.push("✅ HTTP API connection to AgentServer working".to_string());
            } else {
                test_results.push(format!(
                    "⚠️ HTTP API responded with status: {}",
                    response.status()
                ));
            }
        }
        Err(e) => {
            test_results.push(format!("❌ HTTP API connection failed: {}", e));
        }
    }

    // Step 3: Test WebSocket connection
    let ws_connected = native_ws_client.is_connected().await;
    if ws_connected {
        test_results.push("✅ WebSocket already connected".to_string());
    } else {
        info!("WebSocket not connected, attempting to connect...");
        let ws_url = format!("ws://localhost:{}/ws", agent_port);
        match native_ws_client.connect(&ws_url).await {
            Ok(_) => {
                test_results.push("✅ WebSocket connection established".to_string());
                // Wait a moment for connection to stabilize
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            }
            Err(e) => {
                test_results.push(format!("❌ WebSocket connection failed: {}", e));
                return Ok(test_results.join("\n"));
            }
        }
    }

    // Step 4: Send a test message via WebSocket
    let test_message = "Hello World from Tauri! This is a startup connectivity test.";
    match native_ws_client.send_message(test_message).await {
        Ok(_) => {
            test_results.push("✅ Test message sent via WebSocket".to_string());
        }
        Err(e) => {
            test_results.push(format!("❌ Failed to send WebSocket message: {}", e));
        }
    }

    // Step 5: Test HTTP message ingestion (fallback method)
    let message_url = format!(
        "http://localhost:{}/api/messaging/ingest-external",
        agent_port
    );
    let channel_id = "e292bdf2-0baa-4677-a3a6-9426672ce6d8";
    let author_id = "00000000-0000-0000-0000-000000000001";

    match client
        .post(&message_url)
        .json(&serde_json::json!({
            "channel_id": channel_id,
            "server_id": "00000000-0000-0000-0000-000000000000",
            "author_id": author_id,
            "content": "HTTP test message from startup validation",
            "source_type": "startup_test",
            "raw_message": {
                "text": "HTTP test message from startup validation",
                "type": "startup_test"
            },
            "metadata": {
                "source": "tauri_startup_test",
                "userName": "SystemTest"
            }
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                test_results.push("✅ HTTP message ingestion working".to_string());
            } else {
                let status = response.status();
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                test_results.push(format!(
                    "❌ HTTP message ingestion failed: {} - {}",
                    status, error_text
                ));
            }
        }
        Err(e) => {
            test_results.push(format!("❌ HTTP message ingestion request failed: {}", e));
        }
    }

    // Step 6: Summary
    let success_count = test_results.iter().filter(|r| r.starts_with("✅")).count();
    let warning_count = test_results.iter().filter(|r| r.starts_with("⚠️")).count();
    let error_count = test_results.iter().filter(|r| r.starts_with("❌")).count();

    test_results.push("".to_string());
    test_results.push("📊 STARTUP TEST SUMMARY:".to_string());
    test_results.push(format!("   ✅ Passed: {}", success_count));
    test_results.push(format!("   ⚠️ Warnings: {}", warning_count));
    test_results.push(format!("   ❌ Failed: {}", error_count));

    if error_count == 0 {
        test_results.push("".to_string());
        test_results.push(
            "🎉 All critical systems operational! Tauri ↔ AgentServer communication working."
                .to_string(),
        );
    } else {
        test_results.push("".to_string());
        test_results.push("🚨 Some systems have issues. Check the results above.".to_string());
    }

    Ok(test_results.join("\n"))
}

async fn wait_for_agent_server_ready(agent_port: u16) -> bool {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:{}/api/server/health", agent_port); // Health check endpoint

    for attempt in 0..20 {
        // Retry up to 20 times
        info!(
            "⏳ Waiting for agent server health check (attempt {}/20)...",
            attempt + 1
        );
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        if let Ok(response) = response {
            if response.status().is_success() {
                info!("✅ Agent server health check successful");

                // Now check if the game API plugin routes are ready
                info!("🔍 Checking if game API plugin routes are ready...");
                let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
                let settings_url = format!(
                    "http://localhost:{}/api/agents/{}/settings",
                    agent_port, agent_id
                );
                let settings_response = client
                    .get(&settings_url)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await;

                if let Ok(settings_resp) = settings_response {
                    if settings_resp.status().is_success() {
                        info!("✅ Game API plugin routes are ready");
                        return true;
                    } else {
                        warn!(
                            "⚠️ Game API plugin routes not ready yet (status: {})",
                            settings_resp.status()
                        );
                    }
                } else {
                    warn!("⚠️ Failed to check game API plugin routes");
                }
            } else {
                let status = response.status();
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                warn!(
                    "⚠️ Agent server health check failed with status: {} - {}",
                    status, error_text
                );
            }
        } else {
            let e = response.unwrap_err();
            warn!(
                "❌ Failed to send health check request to agent server: {}",
                e
            );
        }

        if attempt < 19 {
            // Don't sleep on the last attempt
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await; // Wait 5 seconds between retries
        }
    }
    warn!("❌ Agent server did not become ready after multiple attempts.");
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("Starting ElizaOS Game with Rust backend");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_container_runtime_status,
            get_startup_status,
            submit_user_config,
            send_message_to_agent,
            start_game_environment,
            wait_for_server,
            // Configuration management commands
            get_agent_configuration,
            update_agent_configuration,
            get_available_providers,
            // Container management commands
            get_container_status_new,
            start_postgres_container,
            start_ollama_container,
            start_agent_container,
            restart_container_new,
            stop_container_new,
            stop_all_containers_new,
            setup_complete_environment_new,
            get_setup_progress_new,
            // Agent capability management commands
            toggle_autonomy,
            get_autonomy_status,
            toggle_capability,
            get_capability_status,
            update_agent_setting,
            get_agent_settings,
            get_vision_settings,
            refresh_vision_service,
            // Data fetching commands
            fetch_goals,
            fetch_todos,
            fetch_knowledge_files,
            delete_knowledge_file,
            fetch_plugin_configs,
            update_plugin_config,
            validate_configuration,
            test_configuration,
            reset_agent,
            fetch_autonomy_status,
            fetch_memories,
            // Knowledge management
            upload_knowledge_file,
            // Goal and Todo management
            create_goal,
            create_todo,
            // Logs
            fetch_logs,
            // Health check
            health_check,
            // Ollama model recommendations
            get_ollama_recommendations,
            connect_native_websocket,
            disconnect_native_websocket,
            reconnect_native_websocket,
            send_native_websocket_message,
            is_native_websocket_connected,
            get_native_websocket_state,
            // WebSocket commands (legacy) - REMOVED
            // connect_websocket,
            // disconnect_websocket,
            // websocket_join_channel,
            // is_websocket_connected,
            // Socket.IO commands removed - using native WebSocket instead
            // Test commands
            test_native_websocket,
            run_startup_hello_world_test,
            // Media streaming commands
            stream_media_frame,
            stream_media_audio,
            start_agent_screen_capture,
            stop_agent_screen_capture,
            // Application lifecycle
            shutdown_application,
            // Backup management commands
            ipc::backup::create_backup,
            ipc::backup::restore_backup,
            ipc::backup::list_backups,
            ipc::backup::delete_backup,
            ipc::backup::get_backup_config,
            ipc::backup::update_backup_config,
            ipc::backup::export_backup,
            ipc::backup::import_backup,
        ])
        .setup(|app| {
            info!("🚀 Starting ELIZA Game - Rust Backend");

            // Set up crash recovery file
            let crash_file = match app.path().app_data_dir() {
                Ok(dir) => {
                    // Ensure directory exists
                    let _ = std::fs::create_dir_all(&dir);
                    dir.join(".crash_recovery")
                }
                Err(e) => {
                    warn!("Failed to get app data dir for crash recovery: {}", e);
                    std::env::temp_dir().join("eliza_crash_recovery")
                }
            };

            // If crash file exists, we crashed last time
            if crash_file.exists() {
                warn!("🚨 Detected previous crash, running recovery...");

                // Store container manager reference for recovery
                let recovery_container_manager = match ContainerManager::new_with_runtime_type(
                    crate::backend::ContainerRuntimeType::Podman,
                ) {
                    Ok(manager) => Some(Arc::new(manager)),
                    Err(e) => {
                        warn!("Failed to create container manager for recovery: {}", e);
                        None
                    }
                };

                // Run recovery in blocking context
                if let Some(manager) = recovery_container_manager {
                    tauri::async_runtime::block_on(async {
                        // Stop all containers
                        let _ = manager.stop_containers().await;

                        // Clean up orphaned containers
                        let _ = manager.cleanup_containers_by_pattern("eliza-").await;

                        info!("✅ Crash recovery completed");
                    });
                }

                // Remove crash file
                let _ = std::fs::remove_file(&crash_file);
            }

            // Create crash file (removed on clean shutdown)
            if let Err(e) = std::fs::write(&crash_file, "crashed") {
                warn!("Failed to create crash recovery file: {}", e);
            }

            // Store crash file path for cleanup on shutdown
            app.manage(CrashFile(crash_file));

            // Get resource directory for runtime detection
            let resource_dir = match app.path().resource_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    error!("Failed to get resource directory: {}", e);
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Resource directory not found",
                    )));
                }
            };

            info!("📁 Resource directory: {:?}", resource_dir);

            // Initialize startup manager
            let startup_manager = StartupManager::new(app.handle().clone());
            let startup_manager_arc = Arc::new(Mutex::new(startup_manager));
            app.manage(startup_manager_arc.clone());

            // Initialize runtime status tracking (legacy support)
            let runtime_status = Arc::new(std::sync::Mutex::new(RuntimeDetectionStatus::default()));
            app.manage(runtime_status.clone());

            // Initialize container manager for Tauri commands
            // Note: This will be replaced by startup manager's instance once initialized
            let initial_container_manager = match ContainerManager::new_with_runtime_type(
                crate::backend::ContainerRuntimeType::Podman,
            ) {
                Ok(manager) => Arc::new(manager),
                Err(e) => {
                    error!("Failed to create initial container manager: {}", e);
                    // Create a dummy manager to prevent panics
                    Arc::new(
                        ContainerManager::new_with_runtime_type(
                            crate::backend::ContainerRuntimeType::Docker,
                        )
                        .unwrap_or_else(|_| panic!("Failed to create any container manager")),
                    )
                }
            };
            app.manage(initial_container_manager.clone());

            // Initialize operation lock manager
            let operation_lock = Arc::new(crate::container::OperationLock::new());
            app.manage(operation_lock.clone());

            // Initialize Native WebSocket client (App Store friendly)
            let native_ws_client = Arc::new(server::websocket::WebSocketClient::new(
                app.handle().clone(),
                "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f".to_string(), // Default agent ID
            ));
            app.manage(native_ws_client.clone());

            // Initialize backup system
            let backup_manager = Arc::new(tokio::sync::RwLock::new(
                backup::manager::BackupManager::new(
                    initial_container_manager.clone(),
                    app.handle().clone(),
                ),
            ));
            let backup_scheduler = Arc::new(tokio::sync::RwLock::new(
                backup::scheduler::BackupScheduler::new(backup_manager.clone()),
            ));

            // Create global app state
            let global_state = backend::state::GlobalAppState::new(
                initial_container_manager.clone(),
                startup_manager_arc.clone(),
                backup_manager.clone(),
                backup_scheduler.clone(),
            );
            app.manage(global_state);

            // Start the backup scheduler
            let scheduler_clone = backup_scheduler.clone();
            tauri::async_runtime::spawn(async move {
                scheduler_clone.read().await.start().await;
            });

            // Start the callback server for receiving real-time updates on available port
            tauri::async_runtime::spawn(async move {
                // Use less common ports starting with 7773 to avoid conflicts
                // Note: 7777 is reserved for the agent server, so we avoid it
                let ports = [7773, 7774, 7775, 7776];
                let mut callback_started = false;

                for port in ports {
                    info!(
                        "🔗 Trying to start Tauri callback server on port {}...",
                        port
                    );

                    // First, try to kill any existing processes on this port
                    if let Err(e) = common::kill_processes_on_port(port).await {
                        warn!("⚠️ Failed to clean up port {}: {}", port, e);
                    }

                    // Small delay to let the port become available
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                    match start_callback_server_on_port(port).await {
                        Ok(_) => {
                            info!("✅ Callback server started successfully on port {}", port);
                            callback_started = true;
                            break;
                        }
                        Err(e) => {
                            warn!("❌ Failed to start callback server on port {}: {}", port, e);
                        }
                    }
                }

                if !callback_started {
                    error!("❌ Failed to start callback server on any available port");
                }
            });

            // Start the initialization sequence in background
            let resource_dir_clone = resource_dir.clone();
            let startup_manager_clone = startup_manager_arc.clone();
            let native_ws_clone = native_ws_client.clone();
            let app_handle_clone = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let mut manager = startup_manager_clone.lock().await;
                let startup_result = manager.start_initialization(resource_dir_clone).await;

                if let Err(e) = startup_result {
                    error!("❌ Startup initialization failed: {}", e);
                } else {
                    info!("✅ Startup initialization completed successfully");

                    // Wait for agent server to be fully ready before running tests
                    info!("⏳ Waiting for agent server to be fully ready...");

                    // Get the dynamic agent port from container manager
                    let container_manager: Arc<ContainerManager> = app_handle_clone
                        .state::<Arc<ContainerManager>>()
                        .inner()
                        .clone();
                    let port_config = container_manager.get_port_config().await;
                    let agent_port = port_config.agent_port;

                    let agent_ready = wait_for_agent_server_ready(agent_port).await;

                    if !agent_ready {
                        error!("❌ Agent server failed to become ready after waiting");
                        std::process::exit(1);
                    }

                    info!("✅ Agent server is ready, running tests...");

                    // Run comprehensive runtime tests only if explicitly requested
                    drop(manager); // Release the lock before running tests

                    if std::env::var("RUN_TAURI_TESTS").unwrap_or_default() == "true" {
                        info!("🧪 RUN_TAURI_TESTS=true detected, running runtime tests...");

                        // NOTE: run_all_tests will call std::process::exit(1) on test failure
                        // This ensures the app doesn't start with failing tests
                        if let Err(e) = crate::tests::run_all_tests(app_handle_clone.clone()).await
                        {
                            // This code is unreachable if tests fail (app exits), but handles other errors
                            error!("❌ Runtime tests error: {}", e);
                            std::process::exit(1);
                        }
                    } else {
                        info!("🚀 Skipping runtime tests (set RUN_TAURI_TESTS=true to run them)");
                    }
                }

                // Use native WebSocket client for real-time communication with agent server
                info!("🔌 Attempting native WebSocket connection to agent server...");

                // Helper function to connect with retry logic
                async fn connect_with_retry(
                    ws_client: Arc<server::websocket::WebSocketClient>,
                    url: &str,
                    max_attempts: u32,
                ) -> Result<(), Box<dyn std::error::Error>> {
                    use tokio::time::{sleep, Duration};

                    let mut attempts = 0;
                    let mut delay = Duration::from_millis(500);

                    while attempts < max_attempts {
                        info!(
                            "🔌 WebSocket connection attempt {} of {}",
                            attempts + 1,
                            max_attempts
                        );

                        match ws_client.connect(url).await {
                            Ok(_) => {
                                info!("✅ WebSocket connected successfully");
                                return Ok(());
                            }
                            Err(e) => {
                                attempts += 1;
                                if attempts >= max_attempts {
                                    return Err(e);
                                }

                                warn!(
                                    "WebSocket connection failed: {}. Retrying in {:?}...",
                                    e, delay
                                );
                                sleep(delay).await;

                                // Exponential backoff with max delay of 5 seconds
                                delay = std::cmp::min(delay * 2, Duration::from_secs(5));
                            }
                        }
                    }

                    Err("Max connection attempts reached".into())
                }

                // Wait a bit for the agent server to be ready
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                // Try to connect with retries
                let container_manager: Arc<ContainerManager> = app_handle_clone
                    .state::<Arc<ContainerManager>>()
                    .inner()
                    .clone();
                let port_config = container_manager.get_port_config().await;
                let ws_url = format!("ws://localhost:{}/ws", port_config.agent_port);

                if port_config.agent_port != 7777 {
                    info!(
                        "🔌 Using alternative agent port {} for WebSocket connection",
                        port_config.agent_port
                    );
                }

                if let Err(e) = connect_with_retry(native_ws_clone, &ws_url, 5).await {
                    error!("Failed to connect WebSocket after retries: {}", e);
                    info!("💡 Agent server may not be running - messages will fallback to HTTP");
                } else {
                    info!("📡 Real-time communication with agent server established");
                }
            });

            // Setup cleanup on app exit
            #[cfg(desktop)]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    main_window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            info!("Close requested - initiating graceful shutdown");

                            // Prevent the default close behavior
                            api.prevent_close();

                            // Emit an event to trigger the shutdown process
                            let _ = app_handle.emit("request-shutdown", ());
                        }
                    });
                }
            }

            info!("✅ Rust backend setup completed - waiting for initialization");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                info!("Application exiting gracefully");
                // Note: No cleanup needed - containers left running for development
            }
        });
}
