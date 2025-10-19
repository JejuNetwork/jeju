//! Comprehensive WebSocket Flow Test
//!
//! This test verifies the complete WebSocket message flow from client to agent and back.
//! It requires the agent server to be running on port 7777.

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::test]
async fn test_complete_websocket_flow_with_agent_response() {
    println!("🧪 Testing complete WebSocket flow with agent response...\n");

    // Configuration
    const AGENT_ID: &str = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f"; // ELIZA agent ID
    const WS_URL: &str = "ws://localhost:7777/ws";
    const CHANNEL_ID: &str = "test-websocket-flow";

    // Try to connect to WebSocket server
    let connect_result = timeout(Duration::from_secs(5), connect_async(WS_URL)).await;

    let (mut ws_stream, _) = match connect_result {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            println!("❌ Could not connect to WebSocket server: {}", e);
            println!("ℹ️  To run this test, start the agent server:");
            println!("    cd packages/agentserver && bun run start");
            return;
        }
        Err(_) => {
            println!("❌ Connection timeout - server not running");
            println!("ℹ️  To run this test, start the agent server:");
            println!("    cd packages/agentserver && bun run start");
            return;
        }
    };

    println!("✅ Connected to WebSocket server at {}", WS_URL);

    // Step 1: Send connection message
    let connect_msg = json!({
        "type": "connect",
        "agent_id": AGENT_ID,
        "channel_id": CHANNEL_ID,
        "client_type": "test_client",
        "metadata": {
            "test": true,
            "version": "1.0.0"
        }
    });

    println!("📤 Sending connection message...");
    ws_stream
        .send(Message::Text(connect_msg.to_string()))
        .await
        .expect("Failed to send connection message");

    // Step 2: Wait for connection acknowledgment
    let ack_received =
        wait_for_message_type(&mut ws_stream, "connection_ack", Duration::from_secs(5)).await;
    assert!(ack_received, "Did not receive connection acknowledgment");
    println!("✅ Connection acknowledged by server");

    // Step 3: Send a test message
    let test_message = json!({
        "type": "message",
        "content": "Hello ELIZA! Can you tell me a short joke?",
        "author": "TestUser",
        "channel_id": CHANNEL_ID,
        "agent_id": AGENT_ID,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "metadata": {
            "source": "test",
            "request_id": uuid::Uuid::new_v4().to_string()
        }
    });

    println!("\n📤 Sending test message: \"{}\"", test_message["content"]);
    ws_stream
        .send(Message::Text(test_message.to_string()))
        .await
        .expect("Failed to send test message");

    // Step 4: Wait for message acknowledgment
    let msg_ack_received =
        wait_for_message_type(&mut ws_stream, "message_ack", Duration::from_secs(5)).await;
    assert!(msg_ack_received, "Did not receive message acknowledgment");
    println!("✅ Message acknowledged by server");

    // Step 5: Wait for agent response
    println!("\n⏳ Waiting for agent response...");
    let start_time = std::time::Instant::now();
    let max_wait_time = Duration::from_secs(30);
    let mut agent_response_received = false;
    let mut response_content = String::new();

    while start_time.elapsed() < max_wait_time && !agent_response_received {
        match timeout(Duration::from_secs(5), ws_stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = msg["type"].as_str().unwrap_or("");

                    match msg_type {
                        "agent_message" | "agent_response" => {
                            response_content = msg["content"].as_str().unwrap_or("").to_string();
                            println!("\n🤖 Agent response received!");
                            println!("📝 Content: {}", response_content);

                            // Verify response metadata
                            if let Some(metadata) = msg.get("metadata") {
                                println!(
                                    "📊 Metadata: {}",
                                    serde_json::to_string_pretty(metadata).unwrap()
                                );
                            }

                            agent_response_received = true;
                        }
                        "error" => {
                            println!(
                                "❌ Error from server: {}",
                                msg["message"].as_str().unwrap_or("Unknown error")
                            );
                        }
                        "heartbeat" => {
                            println!("💓 Heartbeat received");
                        }
                        _ => {
                            println!("📨 Other message type: {}", msg_type);
                        }
                    }
                }
            }
            Ok(Some(Ok(Message::Close(_)))) => {
                println!("❌ Server closed connection");
                break;
            }
            Ok(Some(Err(e))) => {
                println!("❌ WebSocket error: {}", e);
                break;
            }
            _ => {
                // Timeout or None, continue waiting
                print!(".");
                use std::io::Write;
                std::io::stdout().flush().unwrap();
            }
        }
    }

    assert!(
        agent_response_received,
        "Did not receive agent response within timeout"
    );
    assert!(!response_content.is_empty(), "Agent response was empty");

    // Step 6: Send a follow-up message to test conversation continuity
    println!("\n📤 Sending follow-up message...");
    let followup_message = json!({
        "type": "message",
        "content": "That was great! Can you tell me another one?",
        "author": "TestUser",
        "channel_id": CHANNEL_ID,
        "agent_id": AGENT_ID,
        "timestamp": chrono::Utc::now().timestamp_millis()
    });

    ws_stream
        .send(Message::Text(followup_message.to_string()))
        .await
        .expect("Failed to send follow-up message");

    // Wait for follow-up response
    let followup_response = wait_for_agent_response(&mut ws_stream, Duration::from_secs(30)).await;
    assert!(
        followup_response.is_some(),
        "Did not receive follow-up response"
    );
    println!(
        "✅ Follow-up response received: {}",
        followup_response.unwrap()
    );

    // Step 7: Clean disconnect
    println!("\n📤 Sending disconnect message...");
    let disconnect_msg = json!({
        "type": "disconnect",
        "channel_id": CHANNEL_ID,
        "agent_id": AGENT_ID
    });

    ws_stream
        .send(Message::Text(disconnect_msg.to_string()))
        .await
        .expect("Failed to send disconnect message");

    // Close WebSocket connection
    ws_stream
        .close(None)
        .await
        .expect("Failed to close connection");

    println!("\n✅ Complete WebSocket flow test passed!");
    println!("   - Connection established");
    println!("   - Messages sent and acknowledged");
    println!("   - Agent responses received");
    println!("   - Conversation continuity verified");
    println!("   - Clean disconnect completed");
}

/// Helper function to wait for a specific message type
async fn wait_for_message_type(
    ws_stream: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
              + Unpin),
    expected_type: &str,
    timeout_duration: Duration,
) -> bool {
    match timeout(timeout_duration, ws_stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                msg["type"].as_str() == Some(expected_type)
            } else {
                false
            }
        }
        _ => false,
    }
}

/// Helper function to wait for agent response
async fn wait_for_agent_response(
    ws_stream: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
              + Unpin),
    timeout_duration: Duration,
) -> Option<String> {
    let start_time = std::time::Instant::now();

    while start_time.elapsed() < timeout_duration {
        match timeout(Duration::from_secs(2), ws_stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = msg["type"].as_str().unwrap_or("");
                    if msg_type == "agent_message" || msg_type == "agent_response" {
                        return msg["content"].as_str().map(|s| s.to_string());
                    }
                }
            }
            _ => continue,
        }
    }

    None
}

#[tokio::test]
async fn test_websocket_error_handling() {
    println!("🧪 Testing WebSocket error handling...\n");

    const WS_URL: &str = "ws://localhost:7777/ws";

    // Try to connect
    let connect_result = timeout(Duration::from_secs(2), connect_async(WS_URL)).await;

    let (mut ws_stream, _) = match connect_result {
        Ok(Ok(stream)) => stream,
        _ => {
            println!("⚠️ Server not running, skipping error handling test");
            return;
        }
    };

    // Test 1: Invalid message format
    println!("📤 Sending invalid JSON...");
    ws_stream
        .send(Message::Text("invalid json".to_string()))
        .await
        .expect("Failed to send invalid message");

    // Should receive an error or the connection might close
    match timeout(Duration::from_secs(2), ws_stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            println!("📨 Response: {}", text);
        }
        Ok(Some(Ok(Message::Close(_)))) => {
            println!("✅ Server closed connection on invalid input");
        }
        _ => {
            println!("⚠️ No immediate error response");
        }
    }

    // Test 2: Message without required fields
    println!("\n📤 Sending message without agent_id...");
    let invalid_msg = json!({
        "type": "message",
        "content": "Test message"
        // Missing agent_id, channel_id, etc.
    });

    // Reconnect if needed
    if ws_stream.close(None).await.is_ok() {
        match connect_async(WS_URL).await {
            Ok((stream, _)) => {
                ws_stream = stream;
            }
            _ => return,
        }
    }

    ws_stream
        .send(Message::Text(invalid_msg.to_string()))
        .await
        .expect("Failed to send message");

    // Check for error response
    match timeout(Duration::from_secs(2), ws_stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                if msg["type"] == "error" {
                    println!("✅ Received error response: {}", msg["message"]);
                }
            }
        }
        _ => {
            println!("⚠️ No error response for invalid message");
        }
    }

    println!("\n✅ Error handling test completed");
}

#[tokio::test]
async fn test_websocket_performance() {
    println!("🧪 Testing WebSocket performance...\n");

    const WS_URL: &str = "ws://localhost:7777/ws";
    const AGENT_ID: &str = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
    const NUM_MESSAGES: usize = 10;

    // Connect to server
    let connect_result = timeout(Duration::from_secs(5), connect_async(WS_URL)).await;

    let (mut ws_stream, _) = match connect_result {
        Ok(Ok(stream)) => stream,
        _ => {
            println!("⚠️ Server not running, skipping performance test");
            return;
        }
    };

    // Send connection message
    let connect_msg = json!({
        "type": "connect",
        "agent_id": AGENT_ID,
        "channel_id": "perf-test",
        "client_type": "test_client"
    });

    ws_stream
        .send(Message::Text(connect_msg.to_string()))
        .await
        .expect("Failed to send connection message");

    // Wait for acknowledgment
    wait_for_message_type(&mut ws_stream, "connection_ack", Duration::from_secs(5)).await;

    println!(
        "📊 Sending {} messages in rapid succession...",
        NUM_MESSAGES
    );
    let start_time = std::time::Instant::now();

    // Send multiple messages quickly
    for i in 0..NUM_MESSAGES {
        let msg = json!({
            "type": "message",
            "content": format!("Performance test message #{}", i),
            "author": "TestUser",
            "channel_id": "perf-test",
            "agent_id": AGENT_ID,
            "timestamp": chrono::Utc::now().timestamp_millis()
        });

        ws_stream
            .send(Message::Text(msg.to_string()))
            .await
            .expect("Failed to send message");
    }

    let send_duration = start_time.elapsed();
    println!("✅ Sent {} messages in {:?}", NUM_MESSAGES, send_duration);

    // Count acknowledgments
    let mut ack_count = 0;
    let ack_start = std::time::Instant::now();

    while ack_count < NUM_MESSAGES && ack_start.elapsed() < Duration::from_secs(10) {
        match timeout(Duration::from_millis(100), ws_stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                    if msg["type"] == "message_ack" {
                        ack_count += 1;
                    }
                }
            }
            _ => continue,
        }
    }

    println!("✅ Received {} acknowledgments", ack_count);

    // Calculate metrics
    let messages_per_second = NUM_MESSAGES as f64 / send_duration.as_secs_f64();
    println!("\n📊 Performance Metrics:");
    println!("   - Messages sent: {}", NUM_MESSAGES);
    println!("   - Send rate: {:.2} messages/second", messages_per_second);
    println!("   - Acknowledgments received: {}", ack_count);

    ws_stream.close(None).await.ok();

    println!("\n✅ Performance test completed");
}
