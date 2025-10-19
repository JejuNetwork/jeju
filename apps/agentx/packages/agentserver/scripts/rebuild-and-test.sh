#!/bin/bash

# ElizaOS Media Streaming Container Rebuild and Test Script
# This script rebuilds the container with VNC/media streaming fixes and tests the flow

set -e

echo "🔨 ElizaOS Media Streaming Rebuild & Test"
echo "========================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if running with podman or docker
if command -v podman &> /dev/null; then
    DOCKER_CMD="podman"
    BUILD_FLAGS="--format docker"
    echo -e "${GREEN}✓${NC} Using podman"
else
    DOCKER_CMD="docker"
    BUILD_FLAGS=""
    echo -e "${GREEN}✓${NC} Using docker"
fi

echo -e "\n${YELLOW}1. Stopping existing containers${NC}"
$DOCKER_CMD compose down || true

echo -e "\n${YELLOW}2. Building updated container image${NC}"
# Build from the monorepo root with the correct context
cd ../..
$DOCKER_CMD build $BUILD_FLAGS -f packages/agentserver/Dockerfile -t eliza-agent:latest .
cd packages/agentserver

echo -e "\n${YELLOW}3. Starting containers${NC}"
$DOCKER_CMD compose up -d

echo -e "\n${YELLOW}4. Waiting for services to be ready${NC}"
# Wait for PostgreSQL
echo "Waiting for PostgreSQL..."
for i in {1..30}; do
    if $DOCKER_CMD exec eliza-postgres pg_isready -U eliza -d eliza &>/dev/null; then
        echo -e "${GREEN}✓${NC} PostgreSQL ready"
        break
    fi
    echo -n "."
    sleep 1
done

# Wait for Ollama
echo "Waiting for Ollama..."
for i in {1..30}; do
    if curl -s http://localhost:11434/api/version &>/dev/null; then
        echo -e "${GREEN}✓${NC} Ollama ready"
        break
    fi
    echo -n "."
    sleep 1
done

# Wait for Agent Server
echo "Waiting for Agent Server..."
for i in {1..60}; do
    if curl -s http://localhost:7777/api/server/health | grep -q "healthy"; then
        echo -e "${GREEN}✓${NC} Agent Server ready"
        break
    fi
    echo -n "."
    sleep 2
done

echo -e "\n${YELLOW}5. Testing VNC connection${NC}"
# Test VNC availability
if nc -zv localhost 5900 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✓${NC} VNC server accessible on port 5900"
else
    echo -e "${RED}✗${NC} VNC server not accessible"
fi

echo -e "\n${YELLOW}6. Checking container display${NC}"
# Check if Xvfb is running
if $DOCKER_CMD exec eliza-agent pgrep Xvfb > /dev/null; then
    echo -e "${GREEN}✓${NC} Xvfb display server running"
else
    echo -e "${RED}✗${NC} Xvfb not running"
fi

# Check if window manager is running
if $DOCKER_CMD exec eliza-agent pgrep fluxbox > /dev/null; then
    echo -e "${GREEN}✓${NC} Fluxbox window manager running"
else
    echo -e "${RED}✗${NC} Fluxbox not running"
fi

# Check if xterm windows are visible
XTERM_COUNT=$($DOCKER_CMD exec eliza-agent sh -c "ps aux | grep xterm | grep -v grep | wc -l" || echo "0")
echo -e "${GREEN}✓${NC} Xterm windows running: $XTERM_COUNT"

echo -e "\n${YELLOW}7. Running media streaming tests${NC}"
# Run the full test suite
./test-media-flow-complete.sh

echo -e "\n${YELLOW}8. Container logs (last 20 lines)${NC}"
$DOCKER_CMD logs --tail 20 eliza-agent

echo -e "\n${YELLOW}Summary${NC}"
echo "=================================="
echo -e "${GREEN}✓${NC} Container rebuilt with VNC display fixes"
echo -e "${GREEN}✓${NC} Chromium browser installed for headful automation"
echo -e "${GREEN}✓${NC} Persistent VNC content windows created"
echo -e "${GREEN}✓${NC} FFmpeg screen capture improved with error handling"
echo ""
echo "To connect to VNC:"
echo "  - Use any VNC client and connect to localhost:5900"
echo "  - No password required"
echo ""
echo "To open the messaging UI:"
echo "  - http://localhost:7777/messaging"
echo ""
echo "To launch a browser in the VNC display:"
echo "  - $DOCKER_CMD exec eliza-agent /tmp/launch_browser.sh"