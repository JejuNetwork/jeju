// Test script to validate route_message_to_agent function
use reqwest;
use serde_json::{json, Value};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🧪 Testing route_message_to_agent function...");
    
    // This is the exact same logic from the Tauri lib.rs route_message_to_agent function
    let message = "Hello from test!";
    
    // First get the list of agents to find the active agent ID
    let agents_url = "http://localhost:7777/api/agents";
    let client = reqwest::Client::new();
    
    println!("📡 Getting agents from {}", agents_url);
    
    let agents_response = client
        .get(agents_url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await?;
    
    if !agents_response.status().is_success() {
        return Err(format!("Failed to get agents list: {}", agents_response.status()).into());
    }
    
    let agents_data: Value = agents_response.json().await?;
    println!("👥 Agents response: {}", serde_json::to_string_pretty(&agents_data)?);
    
    let agents = agents_data["data"]["agents"].as_array()
        .ok_or("No agents array found")?;
    
    let active_agent = agents.iter()
        .find(|agent| agent["status"] == "active")
        .ok_or("No active agent found")?;
    
    let agent_id = active_agent["id"].as_str()
        .ok_or("Agent ID not found")?;
    
    println!("✅ Found active agent: {}", agent_id);
    
    // Use the messaging ingest-external endpoint to send a message
    let message_url = "http://localhost:7777/api/messaging/ingest-external";
    
    println!("📨 Sending message to {}", message_url);
    
    let payload = json!({
        "channel_id": "b14661f9-37a8-0b7b-bb9c-ee9ea36b30e5", // Terminal room ID from game API plugin
        "server_id": "00000000-0000-0000-0000-000000000000", // Default server ID
        "author_id": "game-user-00000000-0000-0000-0000-000000000001", // Game user ID
        "content": message,
        "source_type": "game_ui",
        "raw_message": {
            "text": message,
            "type": "user_message"
        },
        "metadata": {
            "source": "eliza",
            "userName": "Admin"
        }
    });
    
    println!("📤 Payload: {}", serde_json::to_string_pretty(&payload)?);
    
    let response = client
        .post(message_url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;
    
    let status = response.status();
    let response_text = response.text().await?;
    
    println!("📥 Response status: {}", status);
    println!("📥 Response body: {}", response_text);

    if status.is_success() {
        println!("✅ Message sent successfully to agent {}", agent_id);
        println!("🎉 END-TO-END TEST PASSED!");
    } else {
        println!("❌ Agent responded with status: {} - {}", status, response_text);
        println!("💥 END-TO-END TEST FAILED!");
        return Err(format!("Agent responded with status: {} - {}", status, response_text).into());
    }

    Ok(())
}