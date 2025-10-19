#!/usr/bin/env bats
# BATS performance tests for Tauri application
# Tests performance characteristics and resource usage

# Test configuration
TAURI_APP_PATH=""
SERVER_PORT="7777"
PID_FILE="/tmp/eliza-app-perf-test.pid"

setup() {
    echo "# Setting up performance test environment..." >&3
    
    # Kill any existing processes
    pkill -f "ElizaOS Terminal" || true
    sleep 2
    
    # Find the built Tauri app
    TAURI_APP_PATH="/Users/shawwalters/eliza-dev/packages/game/src-tauri/target/release/bundle/macos/ElizaOS Terminal.app"
    
    if [[ ! -d "$TAURI_APP_PATH" ]]; then
        skip "Tauri app not found at $TAURI_APP_PATH. Run 'npm run tauri:build' first."
    fi
}

teardown() {
    echo "# Cleaning up performance test environment..." >&3
    
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" || true
            sleep 3
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
    
    pkill -f "ElizaOS Terminal" || true
    pkill -f "node.*server.js" || true
    sleep 2
}

# Helper: launch app and wait for readiness
launch_and_wait() {
    echo "# Launching app for performance test..." >&3
    open "$TAURI_APP_PATH" &
    sleep 5
    
    local app_pid=$(pgrep -f "ElizaOS Terminal" | head -1)
    if [[ -n "$app_pid" ]]; then
        echo "$app_pid" > "$PID_FILE"
    fi
    
    # Wait for server to be ready
    local timeout=45
    local start_time=$(date +%s)
    
    while ! nc -z localhost "$SERVER_PORT" 2>/dev/null; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [[ $elapsed -ge $timeout ]]; then
            return 1
        fi
        sleep 1
    done
    
    # Wait for health endpoint
    while ! curl -s -f "http://localhost:$SERVER_PORT/api/server/health" >/dev/null 2>&1; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [[ $elapsed -ge $timeout ]]; then
            return 1
        fi
        sleep 1
    done
    
    return 0
}

@test "Application startup time is under 30 seconds" {
    local start_time=$(date +%s)
    
    launch_and_wait
    
    local end_time=$(date +%s)
    local startup_time=$((end_time - start_time))
    
    echo "# Startup time: ${startup_time} seconds" >&3
    [ "$startup_time" -lt 30 ]
}

@test "Memory usage remains reasonable during startup" {
    launch_and_wait
    
    local pid=$(cat "$PID_FILE")
    
    # Wait for full initialization
    sleep 10
    
    # Get memory usage in MB (RSS)
    local memory_mb=$(ps -o rss= -p "$pid" | awk '{print int($1/1024)}')
    
    echo "# Memory usage: ${memory_mb}MB" >&3
    
    # Should use less than 500MB for reasonable performance
    [ "$memory_mb" -lt 500 ]
}

@test "CPU usage stabilizes after startup" {
    launch_and_wait
    
    local pid=$(cat "$PID_FILE")
    
    # Wait for startup to complete
    sleep 15
    
    # Measure CPU usage over 10 seconds
    local cpu_samples=()
    for i in {1..10}; do
        local cpu=$(ps -o %cpu= -p "$pid" | tr -d ' ')
        cpu_samples+=("$cpu")
        sleep 1
    done
    
    # Calculate average CPU usage
    local total=0
    local count=0
    for cpu in "${cpu_samples[@]}"; do
        total=$(echo "$total + $cpu" | bc)
        count=$((count + 1))
    done
    
    local avg_cpu=$(echo "scale=2; $total / $count" | bc)
    
    echo "# Average CPU usage: ${avg_cpu}%" >&3
    
    # CPU should stabilize under 20% after startup
    local cpu_check=$(echo "$avg_cpu < 20" | bc)
    [ "$cpu_check" -eq 1 ]
}

@test "API response times are acceptable" {
    launch_and_wait
    
    # Test response times for key endpoints
    local endpoints=(
        "/api/server/health"
        "/api/agents"
    )
    
    for endpoint in "${endpoints[@]}"; do
        echo "# Testing response time for $endpoint" >&3
        
        # Measure response time with curl
        local response_time=$(curl -w "%{time_total}" -s -o /dev/null "http://localhost:$SERVER_PORT$endpoint")
        
        echo "# Response time for $endpoint: ${response_time}s" >&3
        
        # Response should be under 2 seconds
        local time_check=$(echo "$response_time < 2.0" | bc)
        [ "$time_check" -eq 1 ]
    done
}

@test "Concurrent request handling performance" {
    launch_and_wait
    
    # Create multiple concurrent requests
    local num_requests=10
    local start_time=$(date +%s)
    local pids=()
    
    echo "# Making $num_requests concurrent requests..." >&3
    
    for i in $(seq 1 $num_requests); do
        curl -s "http://localhost:$SERVER_PORT/api/server/health" > "/tmp/perf_test_$i" &
        pids+=($!)
    done
    
    # Wait for all requests to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done
    
    local end_time=$(date +%s)
    local total_time=$((end_time - start_time))
    
    echo "# $num_requests concurrent requests completed in ${total_time}s" >&3
    
    # All requests should complete within 10 seconds
    [ "$total_time" -lt 10 ]
    
    # Verify all responses are valid
    for i in $(seq 1 $num_requests); do
        run cat "/tmp/perf_test_$i"
        [[ "$output" =~ "\"success\":true" ]]
        rm -f "/tmp/perf_test_$i"
    done
}

@test "Application handles sustained load" {
    launch_and_wait
    
    local pid=$(cat "$PID_FILE")
    local duration=30
    local requests_per_second=2
    local total_requests=$((duration * requests_per_second))
    local success_count=0
    
    echo "# Running sustained load test: $total_requests requests over ${duration}s" >&3
    
    local start_time=$(date +%s)
    
    for i in $(seq 1 $total_requests); do
        if curl -s -f "http://localhost:$SERVER_PORT/api/server/health" >/dev/null 2>&1; then
            success_count=$((success_count + 1))
        fi
        
        # Wait to maintain request rate
        sleep $(echo "scale=2; 1.0 / $requests_per_second" | bc)
    done
    
    local end_time=$(date +%s)
    local actual_duration=$((end_time - start_time))
    local success_rate=$(echo "scale=2; $success_count * 100 / $total_requests" | bc)
    
    echo "# Load test completed: ${success_count}/${total_requests} requests successful (${success_rate}%)" >&3
    echo "# Actual duration: ${actual_duration}s" >&3
    
    # Should achieve at least 95% success rate
    local rate_check=$(echo "$success_rate >= 95" | bc)
    [ "$rate_check" -eq 1 ]
    
    # Process should still be responsive
    run kill -0 "$pid"
    [ "$status" -eq 0 ]
}

@test "WebSocket connection performance" {
    launch_and_wait
    
    # Test WebSocket connection establishment time
    local start_time=$(date +%s)
    
    # Use Node.js to test WebSocket connection
    node -e "
    const io = require('socket.io-client');
    const socket = io('http://localhost:$SERVER_PORT');
    
    const startTime = Date.now();
    
    socket.on('connect', () => {
        const connectTime = Date.now() - startTime;
        console.log('WebSocket connected in ' + connectTime + 'ms');
        
        if (connectTime < 5000) {
            process.exit(0);
        } else {
            process.exit(1);
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('WebSocket connection failed:', error);
        process.exit(1);
    });
    
    setTimeout(() => {
        console.error('WebSocket connection timeout');
        process.exit(1);
    }, 10000);
    "
    
    [ "$?" -eq 0 ]
}

@test "File descriptor usage remains stable" {
    launch_and_wait
    
    local pid=$(cat "$PID_FILE")
    
    # Wait for stabilization
    sleep 10
    
    # Check file descriptor count
    local fd_count=$(lsof -p "$pid" 2>/dev/null | wc -l)
    
    echo "# File descriptors in use: $fd_count" >&3
    
    # Should not use an excessive number of file descriptors
    [ "$fd_count" -lt 200 ]
    
    # Wait a bit more and check again to ensure no leaks
    sleep 20
    local fd_count_later=$(lsof -p "$pid" 2>/dev/null | wc -l)
    
    echo "# File descriptors after 20s: $fd_count_later" >&3
    
    # Should not have grown significantly (allow some variance)
    local fd_growth=$((fd_count_later - fd_count))
    [ "$fd_growth" -lt 20 ]
}