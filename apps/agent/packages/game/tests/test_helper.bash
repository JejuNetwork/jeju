#!/usr/bin/env bash

# BATS test helper functions for ELIZA Game testing

# Check if required commands are available
check_dependencies() {
    local deps=("curl" "jq" "podman" "bun" "python3")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            echo "ERROR: Required dependency '$dep' not found" >&2
            return 1
        fi
    done
}

# Wait for a process to be ready by checking a specific condition
wait_for_condition() {
    local condition="$1"
    local timeout="${2:-30}"
    local sleep_interval="${3:-1}"
    local count=0
    
    while [ $count -lt $timeout ]; do
        if eval "$condition"; then
            return 0
        fi
        sleep "$sleep_interval"
        ((count += sleep_interval))
    done
    return 1
}

# Kill process by PID if it exists
safe_kill() {
    local pid=$1
    local signal=${2:-TERM}
    
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "-$signal" "$pid" 2>/dev/null || true
        return 0
    fi
    return 1
}

# Wait for HTTP endpoint to be ready
wait_for_http() {
    local url="$1"
    local timeout="${2:-30}"
    local expected_status="${3:-200}"
    
    wait_for_condition "curl -s -o /dev/null -w '%{http_code}' '$url' | grep -q '$expected_status'" "$timeout"
}

# Clean up podman containers
cleanup_containers() {
    # Note: These container names match the constants defined in the Rust code:
    # POSTGRES_CONTAINER = "eliza-postgres"
    # OLLAMA_CONTAINER = "eliza-ollama"  
    # AGENT_CONTAINER = "eliza-agent"
    local containers=("eliza-agent" "eliza-postgres" "eliza-ollama")
    for container in "${containers[@]}"; do
        podman stop "$container" 2>/dev/null || true
        podman rm "$container" 2>/dev/null || true
    done
}

# Get container status
get_container_status() {
    local container_name="$1"
    podman ps -a --filter "name=$container_name" --format "{{.Status}}" 2>/dev/null || echo "not found"
}

# Check if port is in use
is_port_in_use() {
    local port="$1"
    lsof -ti:"$port" >/dev/null 2>&1
}

# Wait for port to be free
wait_for_port_free() {
    local port="$1"
    local timeout="${2:-30}"
    
    wait_for_condition "! is_port_in_use $port" "$timeout"
}

# Extract JSON field using jq if available, otherwise basic grep
extract_json_field() {
    local json="$1"
    local field="$2"
    
    if command -v jq >/dev/null 2>&1; then
        echo "$json" | jq -r "$field" 2>/dev/null || echo ""
    else
        # Fallback to basic pattern matching
        echo "$json" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | cut -d'"' -f4
    fi
}

# Log with timestamp
log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# Verify test environment
verify_test_environment() {
    # Check dependencies
    if ! check_dependencies; then
        return 1
    fi
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || ! grep -q "@elizaos/game" package.json 2>/dev/null; then
        echo "ERROR: Not in the game package directory" >&2
        return 1
    fi
    
    # Check if Tauri is available
    if [ ! -d "src-tauri" ]; then
        echo "ERROR: Tauri source directory not found" >&2
        return 1
    fi
    
    return 0
}

# Setup function to be called in setup()
common_setup() {
    # Verify environment
    if ! verify_test_environment; then
        skip "Test environment not properly configured"
    fi
    
    # Clean up any existing processes/containers
    cleanup_containers
    
    # Make sure ports are free
    local ports=(7777 8888 5173)
    for port in "${ports[@]}"; do
        if is_port_in_use "$port"; then
            log_with_timestamp "Warning: Port $port is in use, attempting to free it"
            lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
            sleep 2
        fi
    done
    
    log_with_timestamp "Common setup completed"
}

# Cleanup function to be called in teardown()
common_teardown() {
    log_with_timestamp "Starting common teardown"
    
    # Kill any remaining processes
    pkill -f "cargo tauri dev" 2>/dev/null || true
    pkill -f "target/debug/app" 2>/dev/null || true
    pkill -f "vite dev" 2>/dev/null || true
    
    # Clean up containers
    cleanup_containers
    
    # Wait for ports to be free
    local ports=(7777 8888 5173)
    for port in "${ports[@]}"; do
        if is_port_in_use "$port"; then
            lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
        fi
    done
    
    log_with_timestamp "Common teardown completed"
}