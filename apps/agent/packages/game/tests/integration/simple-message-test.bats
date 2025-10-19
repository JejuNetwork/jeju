#!/usr/bin/env bats

# Simple test to send "hello how are you?" to the agent
# This assumes the agent server is already running

@test "Send 'hello how are you?' to running agent" {
    echo "=== Testing simple message to agent ===" >&3
    
    # Wait a moment for any existing setup
    sleep 2
    
    # Check if agent server is running
    local health_response=$(curl -s "http://localhost:7777/api/server/health" 2>/dev/null || echo "")
    
    if [ -z "$health_response" ]; then
        skip "Agent server not running - please start with 'bun run dev' first"
    fi
    
    echo "Health response: $health_response" >&3
    
    # Send the test message
    local message_response=$(curl -s -X POST "http://localhost:7777/api/messaging/ingest-external" \
        -H "Content-Type: application/json" \
        -d '{
            "channel_id": "game-ui-channel",
            "server_id": "00000000-0000-0000-0000-000000000000",
            "author_id": "00000000-0000-0000-0000-000000000001",
            "content": "hello how are you?",
            "raw_message": {
                "text": "hello how are you?",
                "type": "user_message"
            },
            "source_type": "game_ui",
            "metadata": {
                "callback_url": "http://127.0.0.1:8888/agent-response",
                "source": "eliza",
                "userName": "Admin"
            }
        }')
    
    echo "Message send response: $message_response" >&3
    
    # Verify message was accepted
    [[ "$message_response" =~ "success.*true" ]] || {
        echo "Message not accepted: $message_response" >&3
        return 1
    }
    
    # Wait for agent processing
    sleep 5
    
    # Verify server is still healthy
    local final_health=$(curl -s "http://localhost:7777/api/server/health" 2>/dev/null || echo "")
    [[ "$final_health" =~ "healthy" ]] || {
        echo "Agent not healthy after message: $final_health" >&3
        return 1
    }
    
    echo "=== SUCCESS: Message sent and processed ===" >&3
}

@test "Verify APIs work after message" {
    echo "=== Testing APIs after message ===" >&3
    
    # Test goals API
    local goals=$(curl -s "http://localhost:7777/api/goals" 2>/dev/null || echo "")
    [[ "$goals" =~ "\[" ]] || {
        echo "Goals API failed: $goals" >&3
        return 1
    }
    
    # Test todos API
    local todos=$(curl -s "http://localhost:7777/api/todos" 2>/dev/null || echo "")
    [[ "$todos" =~ "\[" ]] || {
        echo "Todos API failed: $todos" >&3
        return 1
    }
    
    echo "Goals found: $(echo "$goals" | grep -o '}' | wc -l | xargs)" >&3
    echo "=== APIs working correctly ===" >&3
}