#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🧪 ElizaOS Game - Comprehensive Test Suite${NC}"
echo "=========================================="

# Track overall exit code
EXIT_CODE=0

# Detect container runtime (Podman preferred)
if command -v podman &> /dev/null; then
    RUNTIME="podman"
elif command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    RUNTIME="docker"
else
    echo -e "${RED}❌ Neither Podman nor Docker found${NC}"
    exit 1
fi
echo -e "${YELLOW}Using container runtime: $RUNTIME${NC}"

# Function to check if containers are running
check_containers() {
    echo -e "\n${YELLOW}Checking container status...${NC}"
    
    if ! $RUNTIME ps | grep -q "eliza-postgres"; then
        echo -e "${RED}❌ PostgreSQL container is not running${NC}"
        return 1
    fi
    
    if ! $RUNTIME ps | grep -q "eliza-ollama"; then
        echo -e "${RED}❌ Ollama container is not running${NC}"
        return 1
    fi
    
    if ! $RUNTIME ps | grep -q "eliza-agent"; then
        echo -e "${RED}❌ Agent container is not running${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ All containers are running${NC}"
    return 0
}

# Function to wait for agent server
wait_for_agent() {
    echo -e "\n${YELLOW}Waiting for agent server to be ready...${NC}"
    
    for i in {1..30}; do
        if curl -s http://localhost:7777/ > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Agent server is ready${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    
    echo -e "\n${RED}❌ Agent server failed to become ready${NC}"
    return 1
}

# Run E2E tests
run_e2e_tests() {
    echo -e "\n${YELLOW}Running E2E Tests (Cypress)...${NC}"
    echo "------------------------------"
    
    node test-runner.mjs
    local result=$?
    
    if [ $result -eq 0 ]; then
        echo -e "${GREEN}✅ E2E tests passed${NC}"
    else
        echo -e "${RED}❌ E2E tests failed${NC}"
        EXIT_CODE=1
    fi
    
    return $result
}

# Run Tauri runtime tests
run_tauri_tests() {
    echo -e "\n${YELLOW}Running Tauri Runtime Tests...${NC}"
    echo "------------------------------"
    
    # Check if containers are running first
    if ! check_containers; then
        echo -e "${RED}❌ Cannot run Tauri tests without containers${NC}"
        echo "Please start containers with: bun run dev"
        return 1
    fi
    
    # Wait for agent to be ready
    if ! wait_for_agent; then
        echo -e "${RED}❌ Cannot run Tauri tests without agent server${NC}"
        return 1
    fi
    
    # Run the Tauri tests
    cd src-tauri
    RUN_TAURI_TESTS=true cargo run --release
    local result=$?
    cd ..
    
    if [ $result -eq 0 ]; then
        echo -e "${GREEN}✅ Tauri runtime tests passed${NC}"
    else
        echo -e "${RED}❌ Tauri runtime tests failed${NC}"
        EXIT_CODE=1
    fi
    
    return $result
}

# Main execution
echo -e "${YELLOW}Test execution plan:${NC}"
echo "1. Run E2E tests (Cypress)"
echo "2. Run Tauri runtime tests"
echo ""

# Check if we should run only specific tests
if [ "$1" == "e2e" ]; then
    run_e2e_tests
elif [ "$1" == "tauri" ]; then
    run_tauri_tests
else
    # Run all tests
    run_e2e_tests
    run_tauri_tests
fi

# Summary
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}Test Summary:${NC}"

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed${NC}"
fi

echo -e "${YELLOW}========================================${NC}"

exit $EXIT_CODE