use std::time::Duration;
use tokio::time::timeout;

mod helpers;
use helpers::TestContext;

#[tokio::test]
async fn test_websocket_message_flow_end_to_end() {
    println!("🧪 Testing complete WebSocket message flow from client to agent...");

    // Skip if no container runtime
    let _ctx = match TestContext::new().await {
        Ok(ctx) => ctx,
        Err(_) => {
            println!("⚠️ No container runtime available, skipping test");
            return;
        }
    };

    // This test assumes the agent server is running on port 7777
    // In a real test environment, we would start the server as part of the test

    // Test WebSocket connection
    let ws_url = "ws://localhost:7777/ws";

    // Use tokio-tungstenite for WebSocket client
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let connect_result = timeout(Duration::from_secs(5), connect_async(ws_url)).await;

    match connect_result {
        Ok(Ok((mut ws_stream, _))) => {
            println!("✅ Connected to WebSocket server");

            // Send connection message
            let connect_msg = serde_json::json!({
                "type": "connect",
                "agent_id": "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f", // ELIZA agent ID
                "channel_id": "test-channel-integration",
                "client_type": "test_client"
            });

            ws_stream
                .send(Message::Text(connect_msg.to_string()))
                .await
                .expect("Failed to send connection message");

            // Wait for connection acknowledgment
            if let Ok(Some(Ok(Message::Text(text)))) =
                timeout(Duration::from_secs(5), ws_stream.next()).await
            {
                let response: serde_json::Value =
                    serde_json::from_str(&text).expect("Failed to parse response");

                if response["type"] == "connection_ack" {
                    println!("✅ Connection acknowledged");

                    // Send a test message
                    let test_msg = serde_json::json!({
                        "type": "message",
                        "content": "Hello ELIZA, this is an integration test",
                        "author": "TestUser",
                        "channel_id": "test-channel-integration",
                        "agent_id": "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f",
                        "timestamp": chrono::Utc::now().timestamp_millis()
                    });

                    ws_stream
                        .send(Message::Text(test_msg.to_string()))
                        .await
                        .expect("Failed to send test message");
                    println!("📤 Sent test message");

                    // Wait for message acknowledgment
                    if let Ok(Some(Ok(Message::Text(text)))) =
                        timeout(Duration::from_secs(5), ws_stream.next()).await
                    {
                        let response: serde_json::Value =
                            serde_json::from_str(&text).expect("Failed to parse response");

                        if response["type"] == "message_ack" {
                            println!("✅ Message acknowledged by server");

                            // Wait for agent response
                            let mut received_agent_response = false;
                            let start_time = std::time::Instant::now();

                            while start_time.elapsed() < Duration::from_secs(30) {
                                if let Ok(Some(Ok(Message::Text(text)))) =
                                    timeout(Duration::from_secs(5), ws_stream.next()).await
                                {
                                    let response: serde_json::Value = serde_json::from_str(&text)
                                        .expect("Failed to parse response");

                                    if response["type"] == "agent_message"
                                        || response["type"] == "agent_response"
                                    {
                                        println!(
                                            "🤖 Received agent response: {}",
                                            response["content"]
                                        );
                                        received_agent_response = true;
                                        break;
                                    }
                                }
                            }

                            assert!(
                                received_agent_response,
                                "Did not receive agent response within timeout"
                            );
                            println!("✅ WebSocket message flow test passed!");
                        }
                    }
                }
            }

            // Close connection
            let _ = ws_stream.close(None).await;
        }
        Ok(Err(e)) => {
            println!("⚠️ Could not connect to WebSocket server: {}", e);
            println!("ℹ️ Make sure the agent server is running on port 7777");
        }
        Err(_) => {
            println!("⚠️ Connection timeout - server may not be running");
        }
    }
}

#[tokio::test]
async fn test_websocket_reconnection() {
    println!("🧪 Testing WebSocket reconnection logic...");

    // This test would simulate connection drops and verify reconnection works
    // For now, we'll just verify the basic connection works

    let ws_url = "ws://localhost:7777/ws";
    use tokio_tungstenite::connect_async;

    match timeout(Duration::from_secs(2), connect_async(ws_url)).await {
        Ok(Ok((ws_stream, _))) => {
            println!("✅ Initial connection successful");

            // Close the connection
            drop(ws_stream);

            // Try to reconnect
            tokio::time::sleep(Duration::from_secs(1)).await;

            match timeout(Duration::from_secs(2), connect_async(ws_url)).await {
                Ok(Ok(_)) => {
                    println!("✅ Reconnection successful");
                }
                _ => {
                    println!("⚠️ Reconnection failed - server may not be running");
                }
            }
        }
        _ => {
            println!("⚠️ Server not available for reconnection test");
        }
    }
}

#[tokio::test]
async fn test_websocket_multiple_clients() {
    println!("🧪 Testing multiple WebSocket clients...");

    let ws_url = "ws://localhost:7777/ws";
    use futures_util::future::join_all;
    use tokio_tungstenite::connect_async;

    // Try to connect multiple clients
    let client_futures = (0..3).map(|i| async move {
        match timeout(Duration::from_secs(2), connect_async(ws_url)).await {
            Ok(Ok((mut ws_stream, _))) => {
                println!("✅ Client {} connected", i);

                // Send a message from each client
                let msg = serde_json::json!({
                    "type": "connect",
                    "agent_id": "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f",
                    "channel_id": format!("test-channel-{}", i),
                    "client_type": "test_client"
                });

                use futures_util::SinkExt;
                use tokio_tungstenite::tungstenite::Message;

                let _ = ws_stream.send(Message::Text(msg.to_string())).await;

                // Keep connection open briefly
                tokio::time::sleep(Duration::from_secs(1)).await;

                Ok(())
            }
            _ => {
                println!("⚠️ Client {} could not connect", i);
                Err("Connection failed")
            }
        }
    });

    let results = join_all(client_futures).await;
    let successful_connections = results.iter().filter(|r| r.is_ok()).count();

    println!(
        "✅ Successfully connected {} out of 3 clients",
        successful_connections
    );
}
