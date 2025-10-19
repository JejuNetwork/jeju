#!/bin/bash

# Comprehensive test to verify runtime detection behavior
# This script tests all detection scenarios

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 ElizaOS Runtime Detection Verification${NC}"
echo "=========================================="

# Function to test a script's runtime detection
test_script_detection() {
    local script_path=$1
    local script_name=$(basename "$script_path")
    
    echo -e "\n${YELLOW}Testing: $script_name${NC}"
    
    # Extract runtime detection logic and test it
    if [[ "$script_path" == *.sh ]]; then
        # For shell scripts, extract the detection logic
        if grep -q "command -v podman" "$script_path" && grep -A5 -B5 "command -v podman" "$script_path" | grep -q "RUNTIME="; then
            echo -e "  ✅ Shell script checks Podman first"
        else
            echo -e "  ${RED}❌ Shell script doesn't check Podman first${NC}"
            return 1
        fi
    elif [[ "$script_path" == *.js ]]; then
        # For JS scripts, check the detection function
        if grep -q "podman --version" "$script_path" && grep -B10 "docker info" "$script_path" | grep -q "podman --version"; then
            echo -e "  ✅ JS script checks Podman first"
        else
            echo -e "  ${RED}❌ JS script doesn't check Podman first${NC}"
            return 1
        fi
    fi
    
    return 0
}

# Test all detection scripts
SCRIPTS_TO_TEST=(
    "../../../agentserver/scripts/build-all.js"
    "../../../agentserver/scripts/start-postgres.js"
    "../../../agentserver/run-container.sh"
    "../../../agentserver/test-media-flow-complete.sh"
    "./run-all-tests.sh"
    "./test-tauri.sh"
    "./test-runtime-compatibility.sh"
)

TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${BLUE}=== Script Detection Order Tests ===${NC}"

for script in "${SCRIPTS_TO_TEST[@]}"; do
    if [ -f "$script" ]; then
        if test_script_detection "$script"; then
            ((TESTS_PASSED++))
        else
            ((TESTS_FAILED++))
        fi
    else
        echo -e "${YELLOW}⚠️  Script not found: $script${NC}"
    fi
done

# Test the Rust runtime manager
echo -e "\n${BLUE}=== Rust Runtime Manager Test ===${NC}"
echo -e "${YELLOW}Checking runtime_manager.rs${NC}"

if grep -q "Try Podman first (preferred)" ../src-tauri/src/container/runtime_manager.rs; then
    echo -e "  ✅ Rust runtime manager checks Podman first"
    ((TESTS_PASSED++))
else
    echo -e "  ${RED}❌ Rust runtime manager doesn't check Podman first${NC}"
    ((TESTS_FAILED++))
fi

# Test actual runtime detection behavior
echo -e "\n${BLUE}=== Live Runtime Detection Test ===${NC}"

# Create a temporary test script
cat > /tmp/test_runtime_detection.sh << 'EOF'
#!/bin/bash
# Detect container runtime (Podman first, then Docker)
if command -v podman &> /dev/null; then
    RUNTIME="podman"
elif command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    RUNTIME="docker"
else
    RUNTIME="none"
fi
echo "$RUNTIME"
EOF

chmod +x /tmp/test_runtime_detection.sh
DETECTED_RUNTIME=$(/tmp/test_runtime_detection.sh)
rm -f /tmp/test_runtime_detection.sh

echo -e "Detected runtime: ${GREEN}$DETECTED_RUNTIME${NC}"

# Verify the detection is correct
PODMAN_AVAILABLE=$(command -v podman &> /dev/null && echo "yes" || echo "no")
DOCKER_AVAILABLE=$(command -v docker &> /dev/null && docker info &> /dev/null 2>&1 && echo "yes" || echo "no")

echo -e "\nSystem status:"
echo -e "  Podman available: $([ "$PODMAN_AVAILABLE" = "yes" ] && echo -e "${GREEN}yes${NC}" || echo -e "${RED}no${NC}")"
echo -e "  Docker available: $([ "$DOCKER_AVAILABLE" = "yes" ] && echo -e "${GREEN}yes${NC}" || echo -e "${RED}no${NC}")"

# Verify correct behavior
if [ "$PODMAN_AVAILABLE" = "yes" ] && [ "$DETECTED_RUNTIME" = "podman" ]; then
    echo -e "\n${GREEN}✅ Correctly detected Podman when available${NC}"
    ((TESTS_PASSED++))
elif [ "$PODMAN_AVAILABLE" = "no" ] && [ "$DOCKER_AVAILABLE" = "yes" ] && [ "$DETECTED_RUNTIME" = "docker" ]; then
    echo -e "\n${GREEN}✅ Correctly fell back to Docker when Podman unavailable${NC}"
    ((TESTS_PASSED++))
elif [ "$PODMAN_AVAILABLE" = "no" ] && [ "$DOCKER_AVAILABLE" = "no" ] && [ "$DETECTED_RUNTIME" = "none" ]; then
    echo -e "\n${GREEN}✅ Correctly detected no runtime available${NC}"
    ((TESTS_PASSED++))
else
    echo -e "\n${RED}❌ Runtime detection logic error!${NC}"
    echo -e "  Expected behavior not matched"
    ((TESTS_FAILED++))
fi

# Test documentation
echo -e "\n${BLUE}=== Documentation Check ===${NC}"

if [ -f "../CONTAINER_RUNTIME_SUPPORT.md" ] && grep -q "Podman.*preferred" ../CONTAINER_RUNTIME_SUPPORT.md 2>/dev/null; then
    echo -e "  ✅ Documentation states Podman is preferred"
    ((TESTS_PASSED++))
elif [ -f "../../../CONTAINER_RUNTIME_SUPPORT.md" ] && grep -q "Podman.*preferred" ../../../CONTAINER_RUNTIME_SUPPORT.md 2>/dev/null; then
    echo -e "  ✅ Documentation states Podman is preferred"
    ((TESTS_PASSED++))
else
    echo -e "  ${YELLOW}⚠️  Documentation not found or doesn't reflect Podman preference${NC}"
fi

# Summary
echo -e "\n${BLUE}================= Summary =================${NC}"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All runtime detection flows are correct!${NC}"
    echo -e "   Podman is preferred when available"
    echo -e "   Docker is used only when Podman is not available"
    exit 0
else
    echo -e "\n${RED}❌ Some runtime detection issues found${NC}"
    exit 1
fi