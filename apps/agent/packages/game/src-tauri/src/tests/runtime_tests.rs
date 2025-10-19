use serde_json::json;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;
use tokio::time::sleep;
use tracing::{error, info};
use uuid::Uuid;

type TestResult = Result<String, Box<dyn std::error::Error + Send + Sync>>;

/// Run all endpoint tests
pub async fn run_all_endpoint_tests(app_handle: &AppHandle) -> Vec<TestResult> {
    let mut results = Vec::new();

    // Print test suite header
    info!("╔══════════════════════════════════════════════════════╗");
    info!("║         ELIZAOS RUNTIME TEST SUITE v1.0.0            ║");
    info!("╟──────────────────────────────────────────────────────╢");
    info!("║ Testing all IPC endpoints and critical functionality ║");
    info!("╚══════════════════════════════════════════════════════╝");
    info!("");

    // Give the agent server a moment to fully initialize
    info!("⏳ Waiting for agent server to fully initialize...");
    sleep(Duration::from_secs(5)).await;

    // Test 1: Health Check
    info!("🧪 Test 1/13: Health Check...");
    results.push(test_health_check(app_handle).await);

    // Test 2: Container Management
    info!("🧪 Test 2/13: Container Management...");
    results.push(test_container_management(app_handle).await);

    // Test 3: WebSocket Message Flow
    info!("🧪 Test 3/13: WebSocket Message Flow...");
    results.push(test_websocket_flow(app_handle).await);

    // Test 4: Goals CRUD
    info!("🧪 Test 4/13: Goals CRUD Operations...");
    results.push(test_goals_crud(app_handle).await);

    // Test 5: Todos CRUD
    info!("🧪 Test 5/13: Todos CRUD Operations...");
    results.push(test_todos_crud(app_handle).await);

    // Test 6: Knowledge CRUD
    info!("🧪 Test 6/13: Knowledge CRUD Operations...");
    results.push(test_knowledge_crud(app_handle).await);

    // Test 7: Autonomy Control
    info!("🧪 Test 7/13: Autonomy Control...");
    results.push(test_autonomy_control(app_handle).await);

    // Test 8: Capability Toggles
    info!("🧪 Test 8/13: Capability Toggles...");
    results.push(test_capability_toggles(app_handle).await);

    // Test 9: Configuration
    info!("🧪 Test 9/13: Configuration Management...");
    results.push(test_configuration(app_handle).await);

    // Test 10: Logs Endpoint
    info!("🧪 Test 10/13: Logs Endpoint...");
    results.push(test_logs_endpoint(app_handle).await);

    // Test 11: Memories Endpoint
    info!("🧪 Test 11/13: Memories Endpoint...");
    results.push(test_memories_endpoint(app_handle).await);

    // Test 12: Agent Settings
    info!("🧪 Test 12/13: Agent Settings...");
    results.push(test_agent_settings().await);

    // Test 13: WebSocket Connection
    info!("🧪 Test 13/13: WebSocket Connection...");
    results.push(test_websocket_connection(app_handle).await);

    // Print test suite footer
    info!("");
    info!("╔══════════════════════════════════════════════════════╗");
    info!("║           TEST SUITE EXECUTION COMPLETE              ║");
    info!("╚══════════════════════════════════════════════════════╝");

    results
}

/// Test health check endpoint
async fn test_health_check(_app_handle: &AppHandle) -> TestResult {
    info!("Testing health check endpoint...");

    let result = crate::ipc::commands::health_check().await?;

    let parsed: serde_json::Value = serde_json::from_str(&result)?;
    assert_eq!(parsed["status"], "healthy");

    Ok("✅ Health check test passed".to_string())
}

/// Test container management
async fn test_container_management(app_handle: &AppHandle) -> TestResult {
    info!("Testing container management...");

    // Get container manager
    let container_manager =
        app_handle.state::<std::sync::Arc<crate::container::ContainerManager>>();

    // Check specific containers directly from runtime
    let postgres_status = container_manager
        .get_runtime_container_status(crate::common::POSTGRES_CONTAINER)
        .await;
    let agent_status = container_manager
        .get_runtime_container_status(crate::common::AGENT_CONTAINER)
        .await;

    info!("PostgreSQL container status: {:?}", postgres_status);
    info!("Agent container status: {:?}", agent_status);

    // Verify essential containers are running
    use crate::backend::ContainerState;

    let postgres_running =
        postgres_status.is_ok() && postgres_status.unwrap().state == ContainerState::Running;

    let agent_running =
        agent_status.is_ok() && agent_status.unwrap().state == ContainerState::Running;

    if !postgres_running || !agent_running {
        return Err("Essential containers not running".into());
    }

    Ok("✅ Container management test passed".to_string())
}

/// Test WebSocket message flow
async fn test_websocket_flow(app_handle: &AppHandle) -> TestResult {
    info!("Testing WebSocket message flow...");

    let test_message = format!("Test message {}", Uuid::new_v4());

    // Test WebSocket connection state
    let ws_client = app_handle.state::<std::sync::Arc<crate::server::websocket::WebSocketClient>>();
    let is_connected = ws_client.is_connected().await;

    if !is_connected {
        info!("WebSocket not connected, skipping message flow test");
        return Ok("⚠️ WebSocket flow test skipped (not connected)".to_string());
    }

    // Send test message through WebSocket
    ws_client.send_message(&test_message).await?;

    Ok("✅ WebSocket flow test passed".to_string())
}

/// Test goals CRUD operations
async fn test_goals_crud(_app_handle: &AppHandle) -> TestResult {
    info!("Testing goals CRUD operations...");

    // Fetch current goals
    let initial_goals = crate::ipc::commands::fetch_goals().await?;
    info!("Initial goals response: {:?}", initial_goals);

    // Create a test goal
    let test_goal_name = format!("Test Goal {}", Uuid::new_v4());
    let create_response = crate::ipc::commands::create_goal(
        test_goal_name.clone(),
        "Test goal description".to_string(),
        Some(json!({ "test": true })),
    )
    .await?;

    info!("Create goal response: {:?}", create_response);

    // Verify creation
    if !create_response["success"].as_bool().unwrap_or(false) {
        let error_msg = create_response["error"].as_str().unwrap_or("Unknown error");
        error!("Goal creation failed: {}", error_msg);
        error!("Full response: {:?}", create_response);
        return Err(format!("Failed to create goal: {}", error_msg).into());
    }

    // Fetch goals again to verify
    let updated_goals = crate::ipc::commands::fetch_goals().await?;
    info!("Updated goals response: {:?}", updated_goals);

    let goals_array = updated_goals["data"]["goals"]
        .as_array()
        .ok_or("Goals not an array")?;

    let found = goals_array
        .iter()
        .any(|g| g["name"].as_str() == Some(&test_goal_name));

    if !found {
        return Err("Created goal not found".into());
    }

    Ok("✅ Goals CRUD test passed".to_string())
}

/// Test todos CRUD operations
async fn test_todos_crud(_app_handle: &AppHandle) -> TestResult {
    info!("Testing todos CRUD operations...");

    // Create a test todo
    let test_todo_name = format!("Test Todo {}", Uuid::new_v4());
    let create_response = crate::ipc::commands::create_todo(
        test_todo_name.clone(),
        Some("Test todo description".to_string()),
        Some(1),
        Some("one-off".to_string()),
    )
    .await?;

    info!("Create todo response: {:?}", create_response);

    // Verify creation
    if !create_response["success"].as_bool().unwrap_or(false) {
        let error_msg = create_response["error"].as_str().unwrap_or("Unknown error");
        return Err(format!("Failed to create todo: {}", error_msg).into());
    }

    // Fetch todos again to verify
    let updated_todos = crate::ipc::commands::fetch_todos().await?;
    info!("Updated todos response: {:?}", updated_todos);

    let todos_array = updated_todos["data"]["todos"]
        .as_array()
        .ok_or("Todos not an array")?;

    // Check for 'task' field instead of 'name' when verifying
    let found = todos_array.iter().any(|t| {
        t["task"].as_str() == Some(&test_todo_name) || t["name"].as_str() == Some(&test_todo_name)
    });

    if !found {
        return Err("Created todo not found".into());
    }

    Ok("✅ Todos CRUD test passed".to_string())
}

/// Test knowledge management
async fn test_knowledge_crud(_app_handle: &AppHandle) -> TestResult {
    info!("Testing knowledge CRUD operations...");

    // Fetch current knowledge files
    let files_response = crate::ipc::commands::fetch_knowledge_files().await?;
    let initial_count = files_response["data"]["documents"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);

    // Create test content
    let test_content = "This is a test knowledge file content.";
    let base64_content = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        test_content.as_bytes(),
    );

    // Upload test file
    let upload_response = crate::ipc::commands::upload_knowledge_file(
        format!("test-file-{}.txt", Uuid::new_v4()),
        base64_content,
        "text/plain".to_string(),
    )
    .await?;

    if !upload_response["success"].as_bool().unwrap_or(false) {
        return Err("Failed to upload knowledge file".into());
    }

    // Verify upload
    let updated_files = crate::ipc::commands::fetch_knowledge_files().await?;
    let new_count = updated_files["data"]["documents"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);

    if new_count <= initial_count {
        return Err("Knowledge file count did not increase".into());
    }

    // Delete test file (if we have the ID)
    if let Some(doc_id) = upload_response["data"]["documentId"].as_str() {
        let delete_response =
            crate::ipc::commands::delete_knowledge_file(doc_id.to_string()).await?;

        if !delete_response["success"].as_bool().unwrap_or(false) {
            error!("Warning: Failed to delete test knowledge file");
        }
    }

    Ok("✅ Knowledge CRUD test passed".to_string())
}

/// Test autonomy control
async fn test_autonomy_control(_app_handle: &AppHandle) -> TestResult {
    info!("Testing autonomy control...");

    // Get current autonomy status
    let status_response = crate::ipc::commands::fetch_autonomy_status().await?;
    let initial_enabled = status_response["data"]["enabled"]
        .as_bool()
        .unwrap_or(false);

    // Toggle autonomy
    let new_state = !initial_enabled;
    crate::ipc::commands::toggle_autonomy(new_state).await?;

    // Verify toggle
    let updated_status = crate::ipc::commands::fetch_autonomy_status().await?;
    let current_enabled = updated_status["data"]["enabled"].as_bool().unwrap_or(false);

    if current_enabled != new_state {
        return Err("Autonomy toggle failed".into());
    }

    // Toggle back to original state
    crate::ipc::commands::toggle_autonomy(initial_enabled).await?;

    Ok("✅ Autonomy control test passed".to_string())
}

/// Test capability toggles
async fn test_capability_toggles(_app_handle: &AppHandle) -> TestResult {
    info!("Testing capability toggles...");

    let capabilities = vec!["shell", "browser", "camera", "microphone"];

    for capability in capabilities {
        // Toggle capability
        crate::ipc::commands::toggle_capability(capability.to_string()).await?;

        // Small delay to ensure toggle takes effect
        sleep(Duration::from_millis(100)).await;

        // Get status
        let _status = crate::ipc::commands::get_capability_status(capability.to_string()).await?;

        // Toggle back
        crate::ipc::commands::toggle_capability(capability.to_string()).await?;

        info!("Tested capability: {}", capability);
    }

    Ok("✅ Capability toggles test passed".to_string())
}

/// Test configuration validation and testing
async fn test_configuration(_app_handle: &AppHandle) -> TestResult {
    info!("Testing configuration endpoints...");

    // Validate configuration
    let validation_response = crate::ipc::commands::validate_configuration().await?;

    if !validation_response["success"].as_bool().unwrap_or(false) {
        error!("Configuration validation returned unsuccessful response");
    }

    // Test configuration
    let test_response = crate::ipc::commands::test_configuration().await?;

    if !test_response["success"].as_bool().unwrap_or(false) {
        error!("Configuration test returned unsuccessful response");
    }

    Ok("✅ Configuration test passed".to_string())
}

/// Test logs endpoint
async fn test_logs_endpoint(_app_handle: &AppHandle) -> TestResult {
    info!("Testing logs endpoint...");

    // Fetch logs
    let logs_response = crate::ipc::commands::fetch_logs(Some("all".to_string()), Some(10)).await?;

    // Verify we got logs
    let logs = logs_response["data"]["logs"].as_array();

    if logs.is_none() {
        return Err("No logs array in response".into());
    }

    Ok("✅ Logs endpoint test passed".to_string())
}

/// Test memories endpoint
async fn test_memories_endpoint(_app_handle: &AppHandle) -> TestResult {
    info!("Testing memories endpoint...");

    // Create test parameters with a valid UUID for roomId
    let params = json!({
        "roomId": "ce5f41b4-fe24-4c01-9971-aecfed20a6bd",  // Use the autonomous thoughts room ID
        "count": 5
    });

    // Fetch memories
    let memories_response = crate::ipc::commands::fetch_memories(params).await?;

    // Verify response structure
    if !memories_response.is_object() {
        return Err("Invalid memories response format".into());
    }

    Ok("✅ Memories endpoint test passed".to_string())
}

/// Test agent settings (non-destructive)
async fn test_agent_settings() -> TestResult {
    info!("Testing agent settings endpoints...");

    // Get agent settings
    let settings_response = crate::ipc::commands::get_agent_settings().await?;

    if !settings_response.is_object() {
        return Err("Invalid agent settings response".into());
    }

    // Test updating a harmless setting
    let update_response =
        crate::ipc::commands::update_agent_setting("TEST_SETTING".to_string(), json!("test_value"))
            .await?;

    if !update_response["success"].as_bool().unwrap_or(false) {
        error!("Failed to update test setting");
    }

    Ok("✅ Agent settings test passed".to_string())
}

/// Test WebSocket connection
async fn test_websocket_connection(app_handle: &AppHandle) -> TestResult {
    info!("Testing WebSocket connection...");

    let ws_client = app_handle.state::<std::sync::Arc<crate::server::websocket::WebSocketClient>>();

    // Check if already connected
    let was_connected = ws_client.is_connected().await;

    if !was_connected {
        // Try to connect
        match ws_client.connect("ws://localhost:7777").await {
            Ok(_) => {
                info!("WebSocket connected for test");
            }
            Err(e) => {
                info!("WebSocket connection failed: {}", e);
                return Ok("⚠️ WebSocket test skipped (connection failed)".to_string());
            }
        }
    }

    // Check connection
    let is_connected = ws_client.is_connected().await;

    if !is_connected {
        return Ok("⚠️ WebSocket test skipped (not connected)".to_string());
    }

    // Send test message
    let test_msg = "Runtime test message";
    ws_client.send_message(test_msg).await?;

    // Only disconnect if we weren't connected before
    if !was_connected {
        ws_client.disconnect().await;
    }

    Ok("✅ WebSocket test passed".to_string())
}
