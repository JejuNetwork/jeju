use serde_json::Value;
use std::time::Duration;

/// Default timeout for agent server requests
pub const DEFAULT_AGENT_TIMEOUT_SECS: u64 = 30;

/// Agent server base URL
pub const AGENT_SERVER_URL: &str = "http://localhost:7777";

/// Makes an HTTP request to the agent server with configurable timeout and custom port
#[allow(dead_code)]
pub async fn agent_server_request_with_port(
    method: &str,
    endpoint: &str,
    body: Option<Value>,
    timeout_secs: Option<u64>,
    port: u16,
) -> Result<Value, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:{}{}", port, endpoint);
    let timeout = timeout_secs.unwrap_or(DEFAULT_AGENT_TIMEOUT_SECS);

    let mut request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err("Invalid HTTP method".into()),
    };

    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request.timeout(Duration::from_secs(timeout)).send().await?;

    if response.status().is_success() {
        let data: Value = response.json().await?;
        Ok(data)
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!(
            "Agent server responded with status: {} - {}",
            status, error_text
        )
        .into())
    }
}

/// Makes an HTTP request to the agent server with configurable timeout
/// Note: This uses the default port 7777. Use agent_server_request_with_port for dynamic ports.
pub async fn agent_server_request(
    method: &str,
    endpoint: &str,
    body: Option<Value>,
    timeout_secs: Option<u64>,
) -> Result<Value, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", AGENT_SERVER_URL, endpoint);
    let timeout = timeout_secs.unwrap_or(DEFAULT_AGENT_TIMEOUT_SECS);

    let mut request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err("Invalid HTTP method".into()),
    };

    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request.timeout(Duration::from_secs(timeout)).send().await?;

    if response.status().is_success() {
        let data: Value = response.json().await?;
        Ok(data)
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!(
            "Agent server responded with status: {} - {}",
            status, error_text
        )
        .into())
    }
}

/// Health check helper for agent server
/// Note: Kept as utility function for agent health monitoring
#[allow(dead_code)]
pub async fn check_agent_health() -> Result<bool, Box<dyn std::error::Error>> {
    match agent_server_request("GET", "/api/agents", None, Some(5)).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Media streaming helper
pub async fn send_media_data(
    media_type: &str,
    stream_type: Option<&str>,
    data: Vec<u8>,
    timestamp: u64,
    agent_id: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut payload = serde_json::json!({
        "type": media_type,
        "data": data,
        "timestamp": timestamp,
        "agentId": agent_id
    });

    if let Some(st) = stream_type {
        payload["stream_type"] = Value::String(st.to_string());
    }

    agent_server_request("POST", "/api/media/stream", Some(payload), None).await
}
