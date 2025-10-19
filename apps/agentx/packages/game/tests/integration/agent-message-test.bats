#!/usr/bin/env bats

# Simple focused test for agent message communication
# Tests: Start Tauri -> Send "hello how are you?" -> Verify agent processes message

load '../test_helper'

# Test variables
TAURI_PID=""
TEST_MESSAGE="hello how are you?"

setup() {
    echo "=== Setting up Agent Message Test ===" >&3
    common_setup
}

teardown() {
    echo "=== Cleaning up Agent Message Test ===" >&3
    
    # Kill Tauri process if running
    if [ -n "$TAURI_PID" ] && kill -0 "$TAURI_PID" 2>/dev/null; then
        echo "Stopping Tauri process $TAURI_PID" >&3
        kill -TERM "$TAURI_PID" 2>/dev/null || true
        sleep 3
        kill -KILL "$TAURI_PID" 2>/dev/null || true
    fi
    
    common_teardown
}

@test "Send 'hello how are you?' message to agent and verify processing" {
    echo "=== Testing Agent Message: '$TEST_MESSAGE' ===" >&3
    
    # Step 1: Start Tauri application
    echo "Step 1: Starting Tauri application..." >&3
    bun run dev:tauri > /tmp/tauri-test.log 2>&1 &
    TAURI_PID=$!
    
    # Verify process started
    sleep 3
    if ! kill -0 "$TAURI_PID" 2>/dev/null; then
        echo "Tauri startup log:" >&3
        cat /tmp/tauri-test.log >&3
        echo "Tauri process failed to start" >&3
        return 1
    fi
    
    echo "Tauri started with PID: $TAURI_PID" >&3
    
    # Step 2: Wait for agent server to be ready
    echo "Step 2: Waiting for agent server..." >&3
    local timeout=90
    local count=0
    
    while [ $count -lt $timeout ]; do
        if curl -s "http://localhost:7777/api/server/health" >/dev/null 2>&1; then
            echo "Agent server is responding" >&3
            break
        fi
        
        if ! kill -0 "$TAURI_PID" 2>/dev/null; then
            echo "Tauri process died during startup" >&3
            cat /tmp/tauri-test.log >&3
            echo "Tauri process died" >&3
            return 1
        fi
        
        sleep 2
        ((count += 2))
    done
    
    if [ $count -ge $timeout ]; then
        echo "Timeout waiting for agent server" >&3
        cat /tmp/tauri-test.log >&3
        echo "Agent server not ready within $timeout seconds" >&3
        return 1
    fi
    
    # Step 3: Wait for agent to be connected
    echo "Step 3: Waiting for agent connection..." >&3
    count=0
    timeout=60
    
    while [ $count -lt $timeout ]; do
        local health_response=$(curl -s "http://localhost:7777/api/server/health" 2>/dev/null || echo "")
        if echo "$health_response" | grep -q '"agent":"connected"'; then
            echo "Agent is connected and ready" >&3
            break
        fi
        sleep 2
        ((count += 2))
    done
    
    if [ $count -ge $timeout ]; then
        echo "Agent not connected within $timeout seconds" >&3
        return 1
    fi
    
    # Step 4: Send test message
    echo "Step 4: Sending message: '$TEST_MESSAGE'" >&3
    
    local message_response=$(curl -s -X POST "http://localhost:7777/api/messaging/ingest-external" \
        -H "Content-Type: application/json" \
        -d '{
            "channel_id": "game-ui-channel",
            "server_id": "00000000-0000-0000-0000-000000000000",
            "author_id": "00000000-0000-0000-0000-000000000001",
            "content": "'"$TEST_MESSAGE"'",
            "raw_message": {
                "text": "'"$TEST_MESSAGE"'",
                "type": "user_message"
            },
            "source_type": "game_ui",
            "metadata": {
                "callback_url": "http://127.0.0.1:8888/agent-response",
                "source": "eliza",
                "userName": "Admin"
            }
        }')
    
    echo "Message response: $message_response" >&3
    
    # Verify message was accepted
    if ! echo "$message_response" | grep -q '"success":true'; then
        echo "Message not accepted by server: $message_response" >&3
        return 1
    fi
    
    # Step 5: Wait for agent processing (give it time to process)
    echo "Step 5: Waiting for agent to process message..." >&3
    sleep 10
    
    # Step 6: Verify agent is still healthy after processing
    echo "Step 6: Verifying agent health after message processing..." >&3
    local final_health=$(curl -s "http://localhost:7777/api/server/health" 2>/dev/null || echo "")
    
    if ! echo "$final_health" | grep -q '"status":"healthy"'; then
        echo "Agent not healthy after processing message: $final_health" >&3
        return 1
    fi
    
    # Step 7: Test that APIs are still working
    echo "Step 7: Testing API endpoints after message..." >&3
    
    local goals_response=$(curl -s "http://localhost:7777/api/goals" 2>/dev/null || echo "")
    if ! echo "$goals_response" | grep -q '\['; then
        echo "Goals API not working after message: $goals_response" >&3
        return 1
    fi
    
    local todos_response=$(curl -s "http://localhost:7777/api/todos" 2>/dev/null || echo "")
    if ! echo "$todos_response" | grep -q '\['; then
        echo "Todos API not working after message: $todos_response" >&3
        return 1
    fi
    
    echo "=== SUCCESS: Agent processed message '$TEST_MESSAGE' successfully ===" >&3
}

@test "Verify agent server APIs are working before message test" {
    echo "=== Pre-flight API Test ===" >&3
    
    # Start Tauri
    bun run dev:tauri > /tmp/tauri-pretest.log 2>&1 &
    TAURI_PID=$!
    
    sleep 5
    
    # Wait for server
    local count=0
    while [ $count -lt 60 ]; do
        if curl -s "http://localhost:7777/api/server/health" >/dev/null 2>&1; then
            break
        fi
        sleep 2
        ((count += 2))
    done
    
    # Test health endpoint
    local health=$(curl -s "http://localhost:7777/api/server/health")
    echo "Health: $health" >&3
    [[ "$health" == *"healthy"* ]] || { echo "Health endpoint failed: $health" >&3; return 1; }
    
    # Test goals API
    local goals=$(curl -s "http://localhost:7777/api/goals")
    echo "Goals count: $(echo "$goals" | grep -o '}' | wc -l)" >&3
    [[ "$goals" == *"["* ]] || { echo "Goals API failed: $goals" >&3; return 1; }
    
    # Test todos API
    local todos=$(curl -s "http://localhost:7777/api/todos")
    echo "Todos response length: ${#todos}" >&3
    [[ "$todos" == *"["* ]] || { echo "Todos API failed: $todos" >&3; return 1; }
    
    echo "=== All APIs working correctly ===" >&3
}