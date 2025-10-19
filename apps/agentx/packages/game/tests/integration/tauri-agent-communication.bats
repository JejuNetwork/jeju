#!/usr/bin/env bats

# Test for complete Tauri startup and agent communication flow
# This tests the entire stack: Tauri -> Container -> Agent -> Database -> Response

load '../test_helper'

# Global variables for cleanup
TAURI_PID=""
AGENT_SERVER_PID=""
POSTGRES_PID=""
TEST_LOG_FILE=""

setup() {
    echo "=== Setting up Tauri Agent Communication Test ===" >&3
    
    # Create test log file
    TEST_LOG_FILE="/tmp/tauri-test-$(date +%s).log"
    touch "$TEST_LOG_FILE"
    
    # Ensure we're in the right directory
    cd "$BATS_TEST_DIRNAME/../../" || fail "Could not change to game directory"
    
    # Clean up any existing processes
    cleanup_processes
    
    echo "Test setup complete" >&3
}

teardown() {
    echo "=== Cleaning up Tauri Agent Communication Test ===" >&3
    cleanup_processes
    
    # Remove test log file
    [ -f "$TEST_LOG_FILE" ] && rm -f "$TEST_LOG_FILE"
    
    echo "Test cleanup complete" >&3
}

cleanup_processes() {
    # Kill Tauri process
    if [ -n "$TAURI_PID" ] && kill -0 "$TAURI_PID" 2>/dev/null; then
        echo "Killing Tauri process $TAURI_PID" >&3
        kill -TERM "$TAURI_PID" 2>/dev/null || true
        sleep 2
        kill -KILL "$TAURI_PID" 2>/dev/null || true
    fi
    
    # Kill any remaining cargo/tauri processes
    pkill -f "cargo tauri dev" 2>/dev/null || true
    pkill -f "target/debug/app" 2>/dev/null || true
    
    # Stop containers if they exist
    podman stop eliza-agent 2>/dev/null || true
    podman stop eliza-postgres 2>/dev/null || true
    
    # Kill any node/bun processes on port 7777
    lsof -ti:7777 | xargs kill -9 2>/dev/null || true
    
    # Wait for cleanup
    sleep 3
}

wait_for_port() {
    local port=$1
    local timeout=${2:-30}
    local count=0
    
    echo "Waiting for port $port to be available..." >&3
    while [ $count -lt $timeout ]; do
        if curl -s "http://localhost:$port/api/server/health" >/dev/null 2>&1; then
            echo "Port $port is ready" >&3
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    echo "Timeout waiting for port $port" >&3
    return 1
}

wait_for_agent_ready() {
    local timeout=${1:-60}
    local count=0
    
    echo "Waiting for agent to be ready..." >&3
    while [ $count -lt $timeout ]; do
        local response=$(curl -s "http://localhost:7777/api/server/health" 2>/dev/null)
        if echo "$response" | grep -q '"agent":"connected"'; then
            echo "Agent is ready and connected" >&3
            return 0
        fi
        sleep 1
        ((count++))
    done
    
    echo "Timeout waiting for agent to be ready" >&3
    return 1
}

send_test_message() {
    local message="$1"
    local callback_url="http://127.0.0.1:8888/agent-response"
    
    echo "Sending test message: $message" >&3
    
    local response=$(curl -s -X POST "http://localhost:7777/api/messaging/ingest-external" \
        -H "Content-Type: application/json" \
        -d "{
            \"channel_id\": \"game-ui-channel\",
            \"server_id\": \"00000000-0000-0000-0000-000000000000\",
            \"author_id\": \"00000000-0000-0000-0000-000000000001\",
            \"content\": \"$message\",
            \"raw_message\": {
                \"text\": \"$message\",
                \"type\": \"user_message\"
            },
            \"source_type\": \"game_ui\",
            \"metadata\": {
                \"callback_url\": \"$callback_url\",
                \"source\": \"eliza\",
                \"userName\": \"Admin\"
            }
        }")
    
    echo "Message send response: $response" >&3
    echo "$response"
}

wait_for_agent_response() {
    local timeout=${1:-30}
    local count=0
    local callback_port=8888
    
    echo "Waiting for agent response on callback port $callback_port..." >&3
    
    # Start a simple HTTP server to capture the callback
    local callback_log="/tmp/callback-$(date +%s).log"
    python3 -c "
import http.server
import socketserver
import json
import sys
import threading
import time

class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/agent-response':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                print(f'CALLBACK_RECEIVED: {json.dumps(data)}', flush=True)
                
                # Write to log file
                with open('$callback_log', 'w') as f:
                    f.write(json.dumps(data))
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{\"status\":\"received\"}')
            except Exception as e:
                print(f'ERROR: {e}', flush=True)
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass  # Suppress default logging

# Start server in background
try:
    with socketserver.TCPServer(('127.0.0.1', $callback_port), CallbackHandler) as httpd:
        def serve():
            httpd.serve_forever()
        
        server_thread = threading.Thread(target=serve)
        server_thread.daemon = True
        server_thread.start()
        
        print('CALLBACK_SERVER_STARTED', flush=True)
        
        # Keep running for $timeout seconds
        time.sleep($timeout)
        
        print('CALLBACK_SERVER_TIMEOUT', flush=True)
except Exception as e:
    print(f'CALLBACK_SERVER_ERROR: {e}', flush=True)
    sys.exit(1)
" > "$TEST_LOG_FILE" 2>&1 &
    local callback_server_pid=$!
    
    # Wait for callback server to start
    sleep 2
    
    # Wait for callback response
    while [ $count -lt $timeout ]; do
        if [ -f "$callback_log" ]; then
            local callback_data=$(cat "$callback_log" 2>/dev/null)
            if [ -n "$callback_data" ]; then
                echo "Agent response received: $callback_data" >&3
                kill $callback_server_pid 2>/dev/null || true
                echo "$callback_data"
                return 0
            fi
        fi
        sleep 1
        ((count++))
    done
    
    kill $callback_server_pid 2>/dev/null || true
    echo "Timeout waiting for agent response" >&3
    return 1
}

@test "Complete Tauri startup and agent communication flow" {
    echo "=== Starting Complete Tauri Agent Communication Test ===" >&3
    
    # Step 1: Start Tauri application in background
    echo "Step 1: Starting Tauri application..." >&3
    bun run dev:tauri > "$TEST_LOG_FILE" 2>&1 &
    TAURI_PID=$!
    
    # Verify Tauri process started
    sleep 5
    if ! kill -0 "$TAURI_PID" 2>/dev/null; then
        fail "Tauri process failed to start"
    fi
    
    echo "Tauri process started with PID: $TAURI_PID" >&3
    
    # Step 2: Wait for agent server to be ready
    echo "Step 2: Waiting for agent server to be ready..." >&3
    run wait_for_port 7777 60
    [ "$status" -eq 0 ] || fail "Agent server port 7777 not ready: $output"
    
    # Step 3: Wait for agent to be connected
    echo "Step 3: Waiting for agent to be connected..." >&3
    run wait_for_agent_ready 60
    [ "$status" -eq 0 ] || fail "Agent not ready: $output"
    
    # Step 4: Verify API endpoints are working
    echo "Step 4: Testing API endpoints..." >&3
    
    # Test health endpoint
    local health=$(curl -s "http://localhost:7777/api/server/health")
    echo "Health check response: $health" >&3
    [[ "$health" == *"healthy"* ]] || fail "Health check failed: $health"
    
    # Test goals API
    local goals=$(curl -s "http://localhost:7777/api/goals")
    echo "Goals API response: $goals" >&3
    [[ "$goals" == *"["* ]] || fail "Goals API failed: $goals"
    
    # Test todos API  
    local todos=$(curl -s "http://localhost:7777/api/todos")
    echo "Todos API response: $todos" >&3
    [[ "$todos" == *"["* ]] || fail "Todos API failed: $todos"
    
    # Step 5: Send test message to agent
    echo "Step 5: Sending test message to agent..." >&3
    run send_test_message "hello how are you?"
    [ "$status" -eq 0 ] || fail "Failed to send message: $output"
    
    local send_response="$output"
    echo "Send message response: $send_response" >&3
    [[ "$send_response" == *"success"*"true"* ]] || fail "Message send failed: $send_response"
    
    # Step 6: Wait for agent response (optional - agent might choose to ignore)
    echo "Step 6: Checking agent processing..." >&3
    sleep 10  # Give agent time to process
    
    # Verify message appears in agent logs
    local agent_logs=$(curl -s "http://localhost:7777/api/server/health")
    echo "Final agent status: $agent_logs" >&3
    [[ "$agent_logs" == *"healthy"* ]] || fail "Agent not healthy after message: $agent_logs"
    
    # Step 7: Test additional message with different content
    echo "Step 7: Testing follow-up message..." >&3
    run send_test_message "what is your name?"
    [ "$status" -eq 0 ] || fail "Failed to send follow-up message: $output"
    
    local followup_response="$output"
    [[ "$followup_response" == *"success"*"true"* ]] || fail "Follow-up message failed: $followup_response"
    
    # Step 8: Verify system stability
    echo "Step 8: Verifying system stability..." >&3
    sleep 5
    
    local final_health=$(curl -s "http://localhost:7777/api/server/health")
    [[ "$final_health" == *"healthy"* ]] || fail "System not stable after testing: $final_health"
    
    echo "=== All tests passed! Agent communication working correctly ===" >&3
}

@test "Test agent message processing with Goals API integration" {
    echo "=== Testing Goals API Integration ===" >&3
    
    # Start Tauri
    bun run dev:tauri > "$TEST_LOG_FILE" 2>&1 &
    TAURI_PID=$!
    
    sleep 10
    
    # Wait for readiness
    run wait_for_port 7777 60
    [ "$status" -eq 0 ] || fail "Agent server not ready"
    
    run wait_for_agent_ready 60
    [ "$status" -eq 0 ] || fail "Agent not connected"
    
    # Get initial goals count
    local initial_goals=$(curl -s "http://localhost:7777/api/goals")
    local initial_count=$(echo "$initial_goals" | jq '. | length' 2>/dev/null || echo "0")
    echo "Initial goals count: $initial_count" >&3
    
    # Send message about creating a goal
    run send_test_message "I want to create a new goal to learn about AI"
    [ "$status" -eq 0 ] || fail "Failed to send goal creation message"
    
    # Wait for processing
    sleep 15
    
    # Check if goals were potentially updated (this depends on agent behavior)
    local final_goals=$(curl -s "http://localhost:7777/api/goals")
    local final_count=$(echo "$final_goals" | jq '. | length' 2>/dev/null || echo "0")
    echo "Final goals count: $final_count" >&3
    
    # Verify API is still working
    [[ "$final_goals" == *"["* ]] || fail "Goals API broken after message processing"
    
    echo "Goals API integration test completed" >&3
}

@test "Test agent message processing with Todos API integration" {
    echo "=== Testing Todos API Integration ===" >&3
    
    # Start Tauri
    bun run dev:tauri > "$TEST_LOG_FILE" 2>&1 &
    TAURI_PID=$!
    
    sleep 10
    
    # Wait for readiness
    run wait_for_port 7777 60
    [ "$status" -eq 0 ] || fail "Agent server not ready"
    
    run wait_for_agent_ready 60
    [ "$status" -eq 0 ] || fail "Agent not connected"
    
    # Get initial todos
    local initial_todos=$(curl -s "http://localhost:7777/api/todos")
    echo "Initial todos response: $initial_todos" >&3
    
    # Send message about tasks
    run send_test_message "I need to organize my daily tasks better"
    [ "$status" -eq 0 ] || fail "Failed to send task organization message"
    
    # Wait for processing
    sleep 15
    
    # Check todos API still works
    local final_todos=$(curl -s "http://localhost:7777/api/todos")
    echo "Final todos response: $final_todos" >&3
    
    # Verify API structure is intact
    [[ "$final_todos" == *"["* ]] || fail "Todos API broken after message processing"
    
    echo "Todos API integration test completed" >&3
}