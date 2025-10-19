#!/bin/bash

# Test script for Docker/Podman runtime compatibility
# This script verifies that ElizaOS works correctly with both container runtimes

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 ElizaOS Container Runtime Compatibility Test${NC}"
echo "================================================"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if runtime is working
check_runtime() {
    local runtime=$1
    echo -e "\n${YELLOW}Checking $runtime...${NC}"
    
    if ! command_exists "$runtime"; then
        echo -e "${RED}❌ $runtime is not installed${NC}"
        return 1
    fi
    
    # Check if runtime is actually working
    if [ "$runtime" = "docker" ]; then
        if ! docker info >/dev/null 2>&1; then
            echo -e "${RED}❌ $runtime is installed but not running${NC}"
            return 1
        fi
    elif [ "$runtime" = "podman" ]; then
        if ! podman --version >/dev/null 2>&1; then
            echo -e "${RED}❌ $runtime is installed but not accessible${NC}"
            return 1
        fi
    fi
    
    echo -e "${GREEN}✅ $runtime is available and working${NC}"
    return 0
}

# Function to test basic container operations
test_container_operations() {
    local runtime=$1
    echo -e "\n${YELLOW}Testing container operations with $runtime...${NC}"
    
    # Test network creation
    local test_network="eliza-test-network-$$"
    echo -n "  Creating network... "
    if $runtime network create "$test_network" >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        
        # Clean up
        $runtime network rm "$test_network" >/dev/null 2>&1
    else
        echo -e "${RED}❌${NC}"
        return 1
    fi
    
    # Test pulling a small image
    echo -n "  Pulling test image... "
    if $runtime pull alpine:latest >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${RED}❌${NC}"
        return 1
    fi
    
    # Test running a container
    local test_container="eliza-test-container-$$"
    echo -n "  Running test container... "
    if $runtime run -d --name "$test_container" alpine:latest sleep 10 >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        
        # Test exec
        echo -n "  Testing exec command... "
        if $runtime exec "$test_container" echo "test" >/dev/null 2>&1; then
            echo -e "${GREEN}✅${NC}"
        else
            echo -e "${RED}❌${NC}"
        fi
        
        # Clean up
        $runtime stop "$test_container" >/dev/null 2>&1
        $runtime rm "$test_container" >/dev/null 2>&1
    else
        echo -e "${RED}❌${NC}"
        return 1
    fi
    
    echo -e "${GREEN}  All $runtime operations passed!${NC}"
    return 0
}

# Function to test runtime detection
test_runtime_detection() {
    echo -e "\n${YELLOW}Testing runtime detection logic...${NC}"
    
    # Simulate the detection logic from our scripts
    if command -v podman &> /dev/null; then
        echo -e "  Detected runtime: ${GREEN}Podman${NC} (preferred)"
        DETECTED_RUNTIME="podman"
    elif command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
        echo -e "  Detected runtime: ${GREEN}Docker${NC} (fallback)"
        DETECTED_RUNTIME="docker"
    else
        echo -e "  ${RED}No runtime detected${NC}"
        DETECTED_RUNTIME=""
    fi
    
    if [ -n "$DETECTED_RUNTIME" ]; then
        echo -e "${GREEN}✅ Runtime detection successful${NC}"
        return 0
    else
        echo -e "${RED}❌ Runtime detection failed${NC}"
        return 1
    fi
}

# Function to run Rust tests
run_rust_tests() {
    echo -e "\n${YELLOW}Running Rust runtime compatibility tests...${NC}"
    
    cd ../src-tauri
    if cargo test runtime_compatibility_tests -- --nocapture; then
        echo -e "${GREEN}✅ Rust tests passed${NC}"
        cd ..
        return 0
    else
        echo -e "${RED}❌ Rust tests failed${NC}"
        cd ..
        return 1
    fi
}

# Main test execution
DOCKER_AVAILABLE=false
PODMAN_AVAILABLE=false
TESTS_PASSED=0
TESTS_FAILED=0

# Check Podman first (preferred)
if check_runtime "podman"; then
    PODMAN_AVAILABLE=true
    if test_container_operations "podman"; then
        ((TESTS_PASSED++))
    else
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  Skipping Podman tests${NC}"
fi

# Check Docker
if check_runtime "docker"; then
    DOCKER_AVAILABLE=true
    if test_container_operations "docker"; then
        ((TESTS_PASSED++))
    else
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  Skipping Docker tests${NC}"
fi

# Test runtime detection
if test_runtime_detection; then
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# Run Rust tests if at least one runtime is available
if $DOCKER_AVAILABLE || $PODMAN_AVAILABLE; then
    if run_rust_tests; then
        ((TESTS_PASSED++))
    else
        ((TESTS_FAILED++))
    fi
else
    echo -e "\n${RED}❌ No container runtime available!${NC}"
    echo "Please install Docker or Podman to run ElizaOS."
    exit 1
fi

# Summary
echo -e "\n${BLUE}================= Test Summary =================${NC}"
echo -e "Podman available: $([ "$PODMAN_AVAILABLE" = true ] && echo -e "${GREEN}Yes${NC}" || echo -e "${RED}No${NC}")"
echo -e "Docker available: $([ "$DOCKER_AVAILABLE" = true ] && echo -e "${GREEN}Yes${NC}" || echo -e "${RED}No${NC}")"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All tests passed! ElizaOS is compatible with available runtimes.${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please check the output above.${NC}"
    exit 1
fi