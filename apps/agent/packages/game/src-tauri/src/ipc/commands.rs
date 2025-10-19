use crate::backend::*;
use crate::common::{agent_server_request, send_media_data, AGENT_CONTAINER};
use crate::container::*;
use crate::SetupProgress;
use serde_json;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tracing::{error, info, warn};

// Container management commands
/// Gets the status of all managed containers.
///
/// # Errors
///
/// Returns an error if the container manager fails to retrieve container statuses.
#[tauri::command]
pub async fn get_container_status_new(
    state: State<'_, Arc<ContainerManager>>,
) -> Result<Vec<ContainerStatus>, String> {
    match state.get_all_statuses().await {
        Ok(statuses) => Ok(statuses),
        Err(e) => {
            error!("Failed to get container status: {}", e);
            Err(e.to_string())
        }
    }
}

/// Starts a PostgreSQL container with default configuration.
///
/// # Errors
///
/// Returns an error if the container runtime fails to start the PostgreSQL container.
#[tauri::command]
pub async fn start_postgres_container(
    state: State<'_, Arc<ContainerManager>>,
    op_lock: State<'_, Arc<OperationLock>>,
) -> Result<ContainerStatus, String> {
    // Acquire operation lock
    let _guard = op_lock
        .try_lock("start_postgres", "Starting PostgreSQL container")
        .map_err(|e| {
            warn!("Operation already in progress: {}", e.message);
            e.message.clone()
        })?;

    // Find available ports and update configuration
    let available_ports = crate::container::manager::PortConfig::find_available_ports().await;
    state.update_port_config(available_ports).await;
    
    // Ensure network exists before starting postgres
    if let Err(e) = state.ensure_network_exists(crate::common::container_utils::NETWORK_NAME).await {
        return Err(format!("Failed to ensure network exists: {}", e));
    }

    match state.start_postgres().await {
        Ok(status) => {
            info!("PostgreSQL container started successfully");
            Ok(status)
        }
        Err(e) => {
            error!("Failed to start PostgreSQL container: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn start_ollama_container(
    state: State<'_, Arc<ContainerManager>>,
    op_lock: State<'_, Arc<OperationLock>>,
) -> Result<ContainerStatus, String> {
    // Acquire operation lock
    let _guard = op_lock
        .try_lock("start_ollama", "Starting Ollama AI service")
        .map_err(|e| {
            warn!("Operation already in progress: {}", e.message);
            e.message.clone()
        })?;

    match state.start_ollama().await {
        Ok(status) => {
            info!("Ollama container started successfully");
            Ok(status)
        }
        Err(e) => {
            error!("Failed to start Ollama container: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn start_agent_container(
    state: State<'_, Arc<ContainerManager>>,
    op_lock: State<'_, Arc<OperationLock>>,
) -> Result<ContainerStatus, String> {
    // Acquire operation lock
    let _guard = op_lock
        .try_lock("start_agent", "Starting ElizaOS Agent")
        .map_err(|e| {
            warn!("Operation already in progress: {}", e.message);
            e.message.clone()
        })?;

    match state.start_agent().await {
        Ok(status) => {
            info!("ElizaOS Agent container started successfully");
            Ok(status)
        }
        Err(e) => {
            error!("Failed to start ElizaOS Agent container: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn restart_container_new(
    state: State<'_, Arc<ContainerManager>>,
    container_name: String,
) -> Result<ContainerStatus, String> {
    match state.restart_container(&container_name).await {
        Ok(status) => {
            info!("Container {} restarted successfully", container_name);
            Ok(status)
        }
        Err(e) => {
            error!("Failed to restart container {}: {}", container_name, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn stop_container_new(
    state: State<'_, Arc<ContainerManager>>,
    container_name: String,
) -> Result<(), String> {
    match state.stop_container(&container_name).await {
        Ok(()) => {
            info!("Container {} stopped successfully", container_name);
            Ok(())
        }
        Err(e) => {
            error!("Failed to stop container {}: {}", container_name, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn stop_all_containers_new(
    state: State<'_, Arc<ContainerManager>>,
) -> Result<(), String> {
    match state.stop_containers().await {
        Ok(()) => {
            info!("All containers stopped successfully");
            Ok(())
        }
        Err(e) => {
            error!("Failed to stop all containers: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn setup_complete_environment_new(
    state: State<'_, Arc<ContainerManager>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    match state.setup_complete_environment(&resource_dir).await {
        Ok(()) => {
            info!("Complete environment setup finished successfully");
            Ok("Environment setup completed successfully".to_string())
        }
        Err(e) => {
            error!("Failed to setup complete environment: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn get_setup_progress_new(
    state: State<'_, Arc<ContainerManager>>,
) -> Result<SetupProgress, String> {
    Ok(state.get_setup_progress().await)
}

// Agent capability management commands

#[tauri::command]
pub async fn toggle_autonomy(enable: bool) -> Result<serde_json::Value, String> {
    let endpoint = if enable {
        "/autonomy/enable"
    } else {
        "/autonomy/disable"
    };
    match make_agent_server_request("POST", endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to toggle autonomy: {}", e)),
    }
}

#[tauri::command]
pub async fn get_autonomy_status() -> Result<serde_json::Value, String> {
    match make_agent_server_request("GET", "/autonomy/status", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to get autonomy status: {}", e)),
    }
}

#[tauri::command]
pub async fn toggle_capability(capability: String) -> Result<serde_json::Value, String> {
    // Use the actual agent ID that's hardcoded in the game
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!(
        "/api/agents/{}/capabilities/{}/toggle",
        agent_id, capability
    );
    let body = serde_json::json!({ "enabled": true }); // Add the required body
    match make_agent_server_request("POST", &endpoint, Some(body)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to toggle {} capability: {}", capability, e)),
    }
}

#[tauri::command]
pub async fn get_capability_status(capability: String) -> Result<serde_json::Value, String> {
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/agents/{}/capabilities/{}", agent_id, capability);
    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!(
            "Failed to get {} capability status: {}",
            capability, e
        )),
    }
}

#[tauri::command]
pub async fn update_agent_setting(
    setting_name: String,
    value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/agents/{}/settings", agent_id);
    let payload = serde_json::json!({
        "key": setting_name,
        "value": value
    });

    match make_agent_server_request("POST", &endpoint, Some(payload)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to update agent setting: {}", e)),
    }
}

#[tauri::command]
pub async fn get_agent_settings() -> Result<serde_json::Value, String> {
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/agents/{}/settings", agent_id);
    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to get agent settings: {}", e)),
    }
}

#[tauri::command]
pub async fn get_vision_settings() -> Result<serde_json::Value, String> {
    match make_agent_server_request("GET", "/api/agents/default/settings/vision", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to get vision settings: {}", e)),
    }
}

#[tauri::command]
pub async fn refresh_vision_service() -> Result<serde_json::Value, String> {
    match make_agent_server_request("POST", "/api/agents/default/vision/refresh", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to refresh vision service: {}", e)),
    }
}

// Helper function to make requests to the agent server
// Helper function that wraps the common agent_server_request
async fn make_agent_server_request(
    method: &str,
    endpoint: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    agent_server_request(method, endpoint, body, None).await
}

// Helper function with custom timeout
async fn make_agent_server_request_with_timeout(
    method: &str,
    endpoint: &str,
    body: Option<serde_json::Value>,
    timeout_secs: u64,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    agent_server_request(method, endpoint, body, Some(timeout_secs)).await
}

// Data fetching commands
#[tauri::command]
pub async fn fetch_goals() -> Result<serde_json::Value, String> {
    // Include agent ID as query param to ensure plugin route is used
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/goals?agentId={}", agent_id);

    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch goals: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_todos() -> Result<serde_json::Value, String> {
    // Include agent ID as query param to ensure plugin route is used
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/todos?agentId={}", agent_id);

    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch todos: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_knowledge_files() -> Result<serde_json::Value, String> {
    match make_agent_server_request("GET", "/knowledge/documents", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch knowledge files: {}", e)),
    }
}

#[tauri::command]
pub async fn delete_knowledge_file(file_id: String) -> Result<serde_json::Value, String> {
    let endpoint = format!("/knowledge/documents/{}", file_id);
    match make_agent_server_request("DELETE", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to delete knowledge file: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_plugin_configs() -> Result<serde_json::Value, String> {
    match make_agent_server_request("GET", "/api/plugin-config", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch plugin configs: {}", e)),
    }
}

#[tauri::command]
pub async fn update_plugin_config(
    plugin: String,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "plugin": plugin,
        "config": config
    });

    match make_agent_server_request("POST", "/api/plugin-config", Some(body)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to update plugin config: {}", e)),
    }
}

#[tauri::command]
pub async fn validate_configuration() -> Result<serde_json::Value, String> {
    match make_agent_server_request("POST", "/api/config/validate", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to validate configuration: {}", e)),
    }
}

#[tauri::command]
pub async fn test_configuration() -> Result<serde_json::Value, String> {
    match make_agent_server_request_with_timeout("POST", "/api/config/test", None, 30).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to test configuration: {}", e)),
    }
}

#[tauri::command]
pub async fn reset_agent() -> Result<serde_json::Value, String> {
    match make_agent_server_request("POST", "/api/reset-agent", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to reset agent: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_autonomy_status() -> Result<serde_json::Value, String> {
    match make_agent_server_request("GET", "/autonomy/status", None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch autonomy status: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_memories(params: serde_json::Value) -> Result<serde_json::Value, String> {
    // Use the hardcoded agent ID
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";

    // Convert the params object to query string parameters
    let mut query_params = vec![];

    if let Some(room_id) = params.get("roomId").and_then(|v| v.as_str()) {
        query_params.push(format!("roomId={}", room_id));
    }
    if let Some(count) = params.get("count").and_then(|v| v.as_u64()) {
        query_params.push(format!("count={}", count));
    }
    if let Some(entity_id) = params.get("entityId").and_then(|v| v.as_str()) {
        query_params.push(format!("entityId={}", entity_id));
    }
    if let Some(world_id) = params.get("worldId").and_then(|v| v.as_str()) {
        query_params.push(format!("worldId={}", world_id));
    }

    let query_string = if query_params.is_empty() {
        String::new()
    } else {
        format!("?{}", query_params.join("&"))
    };

    let endpoint = format!("/api/memory/{}/memories{}", agent_id, query_string);

    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to fetch memories: {}", e)),
    }
}

// Health check command
#[tauri::command]
pub async fn health_check() -> Result<String, String> {
    let health_status = serde_json::json!({
        "status": "healthy",
        "backend": "rust",
        "timestamp": chrono::Utc::now().timestamp(),
        "components": {
            "container_manager": "operational",
            "agent_manager": "operational",
            "http_server": "operational"
        }
    });

    Ok(health_status.to_string())
}

// Knowledge management commands
#[tauri::command]
pub async fn upload_knowledge_file(
    file_name: String,
    content: String,
    mime_type: String,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose, Engine as _};

    // Decode base64 content
    let decoded_content = general_purpose::STANDARD
        .decode(&content)
        .map_err(|e| format!("Failed to decode base64 content: {}", e))?;

    // Convert decoded content to string
    let file_content = String::from_utf8(decoded_content)
        .unwrap_or_else(|e| String::from_utf8_lossy(&e.into_bytes()).to_string());

    // Create JSON payload with file in body
    let payload = serde_json::json!({
        "file": file_content,
        "fileName": file_name,
        "mimeType": mime_type
    });

    // Make request to upload endpoint
    match make_agent_server_request("POST", "/knowledge/upload", Some(payload)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to upload knowledge file: {}", e)),
    }
}

// Goal management commands
#[tauri::command]
pub async fn create_goal(
    name: String,
    description: String,
    metadata: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::json!({
        "name": name,
        "description": description,
        "metadata": metadata.unwrap_or(serde_json::json!({}))
    });

    // Include agent ID as query param to ensure plugin route is used
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/goals?agentId={}", agent_id);

    match make_agent_server_request("POST", &endpoint, Some(payload)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to create goal: {}", e)),
    }
}

// Todo management commands
#[tauri::command]
pub async fn create_todo(
    name: String,
    description: Option<String>,
    priority: Option<i32>,
    todo_type: Option<String>,
) -> Result<serde_json::Value, String> {
    // The plugin todo endpoint expects these fields
    let payload = serde_json::json!({
        "name": name,
        "type": todo_type.unwrap_or_else(|| "one-off".to_string()),
        "roomId": "ce5f41b4-fe24-4c01-9971-aecfed20a6bd", // Use the autonomous thoughts room
        "priority": priority.unwrap_or(1),
        "description": description,
    });

    // Include agent ID as query param to ensure plugin route is used
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/todos?agentId={}", agent_id);

    match make_agent_server_request("POST", &endpoint, Some(payload)).await {
        Ok(response) => Ok(response),
        Err(e) => Err(format!("Failed to create todo: {}", e)),
    }
}

// Logs endpoint
#[tauri::command]
pub async fn fetch_logs(
    log_type: Option<String>,
    limit: Option<i32>,
) -> Result<serde_json::Value, String> {
    let mut query_params = vec![];

    if let Some(t) = log_type {
        query_params.push(format!("type={}", t));
    }
    if let Some(l) = limit {
        query_params.push(format!("limit={}", l));
    }

    let query_string = if query_params.is_empty() {
        String::new()
    } else {
        format!("?{}", query_params.join("&"))
    };

    let endpoint = format!("/api/logs{}", query_string);

    match make_agent_server_request("GET", &endpoint, None).await {
        Ok(response) => Ok(response),
        Err(e) => {
            // If logs endpoint doesn't exist on server, return empty logs
            warn!("Logs endpoint not available: {}", e);
            Ok(serde_json::json!({
                "success": true,
                "data": {
                    "logs": []
                }
            }))
        }
    }
}

// Media streaming commands

/// Receives video frame data from frontend and forwards it to agent server
#[tauri::command]
pub async fn stream_media_frame(
    native_ws_client: State<'_, Arc<crate::server::websocket::WebSocketClient>>,
    stream_type: String,
    frame_data: Vec<u8>,
    timestamp: u64,
) -> Result<(), String> {
    info!(
        "📹 Received {} frame: {} bytes",
        stream_type,
        frame_data.len()
    );

    // Forward to agent server via WebSocket with optimized method
    if native_ws_client.is_connected().await {
        match native_ws_client
            .send_media_frame(frame_data.clone(), &stream_type)
            .await
        {
            Ok(_) => {
                info!(
                    "✅ Forwarded {} frame to agent server via WebSocket",
                    stream_type
                );
                return Ok(());
            }
            Err(e) => {
                warn!("⚠️ WebSocket send failed, falling back to HTTP: {}", e);
            }
        }
    }

    // Fallback to HTTP API using shared utility
    match send_media_data(
        "video",
        Some(&stream_type),
        frame_data,
        timestamp,
        "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f", // Default agent ID
    )
    .await
    {
        Ok(_) => {
            info!("✅ Forwarded {} frame via HTTP API", stream_type);
            Ok(())
        }
        Err(e) => Err(format!("Failed to send via HTTP: {}", e)),
    }
}

/// Receives audio data from frontend and forwards it to agent server
#[tauri::command]
pub async fn stream_media_audio(
    native_ws_client: State<'_, Arc<crate::server::websocket::WebSocketClient>>,
    audio_data: Vec<u8>,
    timestamp: u64,
) -> Result<(), String> {
    info!("🎤 Received audio chunk: {} bytes", audio_data.len());

    // Forward to agent server via WebSocket with optimized method
    if native_ws_client.is_connected().await {
        match native_ws_client.send_audio_chunk(audio_data.clone()).await {
            Ok(_) => {
                info!("✅ Forwarded audio chunk to agent server via WebSocket");
                return Ok(());
            }
            Err(e) => {
                warn!("⚠️ WebSocket send failed, falling back to HTTP: {}", e);
            }
        }
    }

    // Fallback to HTTP API using shared utility
    match send_media_data(
        "audio",
        None,
        audio_data,
        timestamp,
        "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f", // Default agent ID
    )
    .await
    {
        Ok(_) => {
            info!("✅ Forwarded audio chunk via HTTP API");
            Ok(())
        }
        Err(e) => Err(format!("Failed to send via HTTP: {}", e)),
    }
}

/// Starts agent screen capture (when agent has virtual screen)
#[tauri::command]
pub async fn start_agent_screen_capture() -> Result<(), String> {
    info!("🖥️ Starting agent screen capture");

    // Call agent server endpoint to start screen capture
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/agents/{}/screen/start", agent_id);

    match make_agent_server_request("POST", &endpoint, None).await {
        Ok(_) => {
            info!("✅ Agent screen capture started");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to start agent screen capture: {}", e);
            Err(format!("Failed to start screen capture: {}", e))
        }
    }
}

/// Stops agent screen capture
#[tauri::command]
pub async fn stop_agent_screen_capture() -> Result<(), String> {
    info!("🛑 Stopping agent screen capture");

    // Call agent server endpoint to stop screen capture
    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    let endpoint = format!("/api/agents/{}/screen/stop", agent_id);

    match make_agent_server_request("POST", &endpoint, None).await {
        Ok(_) => {
            info!("✅ Agent screen capture stopped");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to stop agent screen capture: {}", e);
            Err(format!("Failed to stop screen capture: {}", e))
        }
    }
}

#[tauri::command]
pub async fn recover_agent_container(
    container_manager: State<'_, Arc<ContainerManager>>,
) -> Result<String, String> {
    info!("🚨 Starting agent container recovery...");

    // Check agent container status
    match container_manager
        .get_runtime_container_status(AGENT_CONTAINER)
        .await
    {
        Ok(status) => {
            info!("Agent container status: {:?}", status.state);

            match status.state {
                ContainerState::Stopped => {
                    // Container exists but stopped, restart it
                    info!("Agent container is stopped, attempting to restart...");

                    match container_manager.restart_container(AGENT_CONTAINER).await {
                        Ok(_) => {
                            info!("Agent container restarted successfully");

                            // Wait for it to become healthy
                            if let Err(e) = container_manager
                                .wait_for_container_health(
                                    AGENT_CONTAINER,
                                    std::time::Duration::from_secs(30),
                                )
                                .await
                            {
                                error!("Agent container failed health check after restart: {}", e);

                                // Get logs for debugging
                                if let Ok(logs) = container_manager
                                    .get_container_logs(AGENT_CONTAINER, Some(100))
                                    .await
                                {
                                    error!("Recent agent container logs:");
                                    for line in logs.lines().take(50) {
                                        error!("  {}", line);
                                    }
                                }

                                return Err(format!(
                                    "Agent container unhealthy after restart: {}",
                                    e
                                ));
                            }

                            Ok("Agent container recovered successfully".to_string())
                        }
                        Err(e) => {
                            error!("Failed to restart agent container: {}", e);
                            Err(format!("Failed to restart agent container: {}", e))
                        }
                    }
                }
                ContainerState::Running => {
                    // Container is running but agent process may have crashed
                    info!("Container is running but agent process may have crashed");

                    // Get logs to see what happened
                    if let Ok(logs) = container_manager
                        .get_container_logs(AGENT_CONTAINER, Some(100))
                        .await
                    {
                        error!("Recent agent container logs:");
                        for line in logs.lines().take(50) {
                            error!("  {}", line);
                        }
                    }

                    // Restart the container to recover
                    info!("Restarting agent container to recover from crash...");
                    match container_manager.restart_container(AGENT_CONTAINER).await {
                        Ok(_) => {
                            info!("Agent container restarted after crash");

                            // Wait for health
                            if container_manager
                                .wait_for_container_health(
                                    AGENT_CONTAINER,
                                    std::time::Duration::from_secs(30),
                                )
                                .await
                                .is_ok()
                            {
                                Ok("Agent container recovered from crash".to_string())
                            } else {
                                Err("Agent container failed to become healthy after recovery"
                                    .to_string())
                            }
                        }
                        Err(e) => {
                            error!("Failed to restart crashed container: {}", e);
                            Err(format!("Failed to restart crashed container: {}", e))
                        }
                    }
                }
                _ => {
                    warn!("Agent container in unexpected state: {:?}", status.state);
                    Err(format!(
                        "Agent container in unexpected state: {:?}",
                        status.state
                    ))
                }
            }
        }
        Err(e) => {
            warn!("Agent container not found: {}", e);

            // Container doesn't exist, try to start it
            info!("Attempting to start agent container...");
            match container_manager.start_agent().await {
                Ok(_) => {
                    info!("Agent container started successfully");

                    // Wait for health
                    if container_manager
                        .wait_for_container_health(
                            AGENT_CONTAINER,
                            std::time::Duration::from_secs(60),
                        )
                        .await
                        .is_ok()
                    {
                        Ok("Agent container started successfully".to_string())
                    } else {
                        Err("Agent container failed to become healthy".to_string())
                    }
                }
                Err(e) => {
                    error!("Failed to start agent container: {}", e);
                    Err(format!("Failed to start agent container: {}", e))
                }
            }
        }
    }
}

/// Gracefully shuts down the application by stopping all containers first
#[tauri::command]
pub async fn shutdown_application(
    app: tauri::AppHandle,
    container_manager: State<'_, Arc<ContainerManager>>,
    crash_file: State<'_, crate::CrashFile>,
    global_state: State<'_, crate::backend::state::GlobalAppState>,
) -> Result<(), String> {
    info!("🔄 Starting application shutdown sequence...");

    // Hide the main window during shutdown
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }

    // Create shutdown backup
    app.emit("shutdown-progress", "Creating shutdown backup...")
        .unwrap();
    info!("💾 Creating shutdown backup...");

    let backup_manager = global_state.backup_manager.read().await;
    match backup_manager.create_shutdown_backup().await {
        Ok(()) => {
            info!("✅ Shutdown backup created successfully");
            app.emit("shutdown-progress", "Backup created successfully")
                .unwrap();
        }
        Err(e) => {
            error!("❌ Failed to create shutdown backup: {}", e);
            // Continue with shutdown even if backup fails
        }
    }

    // Emit shutdown progress event
    app.emit("shutdown-progress", "Stopping containers...")
        .unwrap();

    // Stop all containers
    info!("📦 Stopping all containers...");
    match container_manager.stop_containers().await {
        Ok(()) => {
            info!("✅ All containers stopped successfully");
            app.emit("shutdown-progress", "Containers stopped successfully")
                .unwrap();
        }
        Err(e) => {
            error!("❌ Failed to stop containers: {}", e);
            app.emit(
                "shutdown-progress",
                &format!("Error stopping containers: {}", e),
            )
            .unwrap();
            // Continue with shutdown even if container stop fails
        }
    }

    // Remove crash recovery file on clean shutdown
    if let Err(e) = std::fs::remove_file(&crash_file.0) {
        warn!("Failed to remove crash recovery file: {}", e);
    } else {
        info!("✅ Removed crash recovery file");
    }

    // Give a moment for the UI to update
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Exit the application
    info!("👋 Exiting application...");
    app.exit(0);

    Ok(())
}

// System and Ollama model recommendations
#[tauri::command]
pub async fn get_ollama_recommendations() -> Result<serde_json::Value, String> {
    use crate::startup::MemoryConfig;

    info!("Getting Ollama model recommendations based on system specs");

    // Get system memory info
    let memory_config = MemoryConfig::calculate();
    let total_memory_gb = memory_config.total_system_memory_mb as f64 / 1024.0;

    // Define model recommendations based on memory
    let mut recommended_models = vec![];
    let mut available_models = vec![];

    // Define model requirements (model_name, min_memory_gb, description)
    let model_specs = vec![
        (
            "llama3.2:1b",
            2.0,
            "Smallest Llama 3.2 model, fast responses",
        ),
        (
            "llama3.2:3b",
            4.0,
            "Default model, good balance of speed and quality",
        ),
        (
            "llama3.1:8b",
            8.0,
            "Latest Llama 3.1 with improved performance",
        ),
        (
            "mixtral:8x7b",
            32.0,
            "Mixture of experts model, very capable",
        ),
        ("llama3.1:70b", 40.0, "Large model for high-end systems"),
    ];

    // Try to get actual Ollama models if available
    let ollama_models = match get_ollama_models_list().await {
        Ok(models) => models,
        Err(e) => {
            warn!("Failed to fetch Ollama models: {}, using defaults", e);
            vec![]
        }
    };

    // Categorize models based on system memory
    for (model, min_memory, description) in &model_specs {
        let model_info = serde_json::json!({
            "name": model,
            "description": description,
            "min_memory_gb": min_memory,
            "recommended": total_memory_gb >= *min_memory,
            "installed": ollama_models.contains(&model.to_string()),
        });

        if total_memory_gb >= *min_memory {
            recommended_models.push(model_info.clone());
        }
        available_models.push(model_info);
    }

    // Sort recommended models by memory requirement (ascending)
    recommended_models.sort_by(|a, b| {
        let a_mem = a["min_memory_gb"].as_f64().unwrap_or(0.0);
        let b_mem = b["min_memory_gb"].as_f64().unwrap_or(0.0);
        a_mem
            .partial_cmp(&b_mem)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(serde_json::json!({
        "success": true,
        "system_info": {
            "total_memory_gb": total_memory_gb,
            "total_memory_mb": memory_config.total_system_memory_mb,
            "recommended_memory_mb": memory_config.podman_machine_memory_mb,
            "has_sufficient_memory": memory_config.has_sufficient_memory,
        },
        "recommended_models": recommended_models,
        "all_models": available_models,
        "default_model": if total_memory_gb >= 4.0 { "llama3.2:3b" } else { "llama3.2:1b" },
        "installed_models": ollama_models,
    }))
}

// Helper function to get list of installed Ollama models
async fn get_ollama_models_list() -> Result<Vec<String>, String> {
    use tokio::process::Command;

    // Try to get models from containerized Ollama
    let output = match Command::new("podman")
        .args(["exec", "eliza-ollama", "ollama", "list"])
        .output()
        .await
    {
        Ok(output) => output,
        Err(_) => {
            // Fallback to docker if podman fails
            Command::new("docker")
                .args(["exec", "eliza-ollama", "ollama", "list"])
                .output()
                .await
                .map_err(|e| format!("Failed to list Ollama models: {}", e))?
        }
    };

    if !output.status.success() {
        return Err("Failed to execute ollama list command".to_string());
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let models: Vec<String> = output_str
        .lines()
        .skip(1) // Skip header line
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if !parts.is_empty() {
                Some(parts[0].to_string())
            } else {
                None
            }
        })
        .collect();

    Ok(models)
}
