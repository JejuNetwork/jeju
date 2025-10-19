#!/bin/bash

# Complete Media Flow Test Script for ElizaOS
# Tests all components of bidirectional media streaming

set -e

echo "🧪 ElizaOS Complete Media Flow Test"
echo "==================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AGENT_ID="2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f"
BASE_URL="http://localhost:7777"

# Detect container runtime
if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    RUNTIME="docker"
elif command -v podman &> /dev/null; then
    RUNTIME="podman"
else
    echo -e "${RED}❌ Neither Docker nor Podman found${NC}"
    exit 1
fi
echo -e "${BLUE}Using container runtime: $RUNTIME${NC}"

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected="$3"
    
    echo -ne "${YELLOW}Testing:${NC} $test_name... "
    
    if eval "$test_command" 2>/dev/null | grep -q "$expected" 2>/dev/null; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

echo -e "\n${BLUE}=== 1. Infrastructure Tests ===${NC}"

# Test server health
run_test "Server Health" \
    "curl -s $BASE_URL/api/server/health" \
    '"status":"healthy"'

# Test database connection
run_test "Database Connection" \
    "curl -s $BASE_URL/api/server/health | jq -r .database" \
    "connected"

# Test WebSocket endpoint
run_test "WebSocket Endpoint" \
    "curl -s -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' $BASE_URL/ws | head -1" \
    "HTTP/1.1"

# Test messaging UI
run_test "Messaging UI Available" \
    "curl -s $BASE_URL/messaging | head -10" \
    "ElizaOS Messaging"

echo -e "\n${BLUE}=== 2. VNC Display Tests ===${NC}"

# Test VNC port
if nc -zv localhost 5900 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✓ VNC Port 5900 accessible${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ VNC Port 5900 not accessible${NC}"
    ((TESTS_FAILED++))
fi

# Test Xvfb running in container
if $RUNTIME exec eliza-agent pgrep Xvfb > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Xvfb display server running${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Xvfb not running${NC}"
    ((TESTS_FAILED++))
fi

# Test window manager
if $RUNTIME exec eliza-agent pgrep fluxbox > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Fluxbox window manager running${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Fluxbox not running${NC}"
    ((TESTS_FAILED++))
fi

# Test VNC server
if $RUNTIME exec eliza-agent pgrep x11vnc > /dev/null 2>&1; then
    echo -e "${GREEN}✓ x11vnc server running${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ x11vnc not running${NC}"
    ((TESTS_FAILED++))
fi

echo -e "\n${BLUE}=== 3. Screen Capture Tests ===${NC}"

# Check if screen capture is already running (auto-started)
CAPTURE_STATUS=$(curl -s "$BASE_URL/api/agents/$AGENT_ID/screen/latest" 2>/dev/null || echo '{}')
if echo "$CAPTURE_STATUS" | grep -q '"frame"'; then
    echo -e "${GREEN}✓ Screen capture auto-started${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${YELLOW}⚠ Screen capture not auto-started, starting manually...${NC}"
    # Try to start it manually
    START_RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/$AGENT_ID/screen/start" 2>/dev/null || echo '{}')
    if echo "$START_RESPONSE" | grep -q '"success":true'; then
        echo -e "${GREEN}✓ Screen capture started manually${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ Failed to start screen capture${NC}"
        ((TESTS_FAILED++))
    fi
fi

# Wait a bit for frames to be captured
sleep 3

# Test latest frame retrieval
run_test "Get Latest Frame" \
    "curl -s $BASE_URL/api/agents/$AGENT_ID/screen/latest" \
    '"frame"'

echo -e "\n${BLUE}=== 4. Media Stream Tests ===${NC}"

# Test video stream endpoint
VIDEO_TEST=$(curl -s -X POST $BASE_URL/api/media/stream \
    -H "Content-Type: application/json" \
    -d '{
        "agentId": "'$AGENT_ID'",
        "type": "video",
        "data": [137, 80, 78, 71, 13, 10, 26, 10]
    }' 2>/dev/null || echo '{}')

if echo "$VIDEO_TEST" | grep -q '"received":true'; then
    echo -e "${GREEN}✓ Video stream endpoint working${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Video stream endpoint failed${NC}"
    ((TESTS_FAILED++))
fi

# Test audio stream endpoint
AUDIO_TEST=$(curl -s -X POST $BASE_URL/api/media/stream \
    -H "Content-Type: application/json" \
    -d '{
        "agentId": "'$AGENT_ID'",
        "type": "audio",
        "data": [82, 73, 70, 70]
    }' 2>/dev/null || echo '{}')

if echo "$AUDIO_TEST" | grep -q '"received":true'; then
    echo -e "${GREEN}✓ Audio stream endpoint working${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Audio stream endpoint failed${NC}"
    ((TESTS_FAILED++))
fi

# Test media status
run_test "Media Status Endpoint" \
    "curl -s '$BASE_URL/api/media/status?agentId=$AGENT_ID'" \
    '"success":true'

echo -e "\n${BLUE}=== 5. Plugin Integration Tests ===${NC}"

# Check if vision plugin is loaded
SERVICES=$(curl -s $BASE_URL/api/debug/services 2>/dev/null || echo '{}')
if echo "$SERVICES" | grep -qi "vision"; then
    echo -e "${GREEN}✓ Vision plugin loaded${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${YELLOW}⚠ Vision plugin not found (may not be configured)${NC}"
fi

# Check game API plugin routes
GAME_API_TEST=$(curl -s $BASE_URL/api/game/health 2>/dev/null || echo '{}')
if echo "$GAME_API_TEST" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✓ Game API plugin routes registered${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Game API plugin routes not working${NC}"
    ((TESTS_FAILED++))
fi

echo -e "\n${BLUE}=== 6. Browser in VNC Test ===${NC}"

# Check if Chromium is installed
if $RUNTIME exec eliza-agent which chromium > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Chromium browser installed${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Chromium not found${NC}"
    ((TESTS_FAILED++))
fi

echo -e "\n${BLUE}=== Test Summary ===${NC}"
echo "=================================="
echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "${RED}Failed:${NC} $TESTS_FAILED"
TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
echo -e "${BLUE}Total:${NC} $TOTAL_TESTS"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All tests passed! Media streaming is fully functional.${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Check the output above for details.${NC}"
    exit 1
fi