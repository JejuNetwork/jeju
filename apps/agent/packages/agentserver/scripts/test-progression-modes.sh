#!/bin/bash

# Test script for progression modes
echo "Testing Capability Progression Modes"
echo "===================================="

API_URL="http://localhost:7777/api/agents/default"

# Check if server is running
echo -n "Checking if server is running... "
if curl -s "$API_URL/settings" > /dev/null; then
    echo "✓"
else
    echo "✗"
    echo "Please start the agent server first: bun run packages/agentserver/src/index.ts"
    exit 1
fi

# Get current progression status
echo -e "\n1. Getting current progression status:"
curl -s "$API_URL/progression" | jq '.'

# Switch to unlocked mode
echo -e "\n2. Switching to unlocked mode:"
curl -s -X POST "$API_URL/progression/mode" \
    -H "Content-Type: application/json" \
    -d '{"mode": "unlocked"}' | jq '.'

# Verify all capabilities are unlocked
echo -e "\n3. Verifying unlocked capabilities:"
curl -s "$API_URL/progression" | jq '.data.unlockedCapabilities'

# Switch back to progression mode
echo -e "\n4. Switching back to progression mode:"
curl -s -X POST "$API_URL/progression/mode" \
    -H "Content-Type: application/json" \
    -d '{"mode": "progression"}' | jq '.'

# Verify reset to initial state
echo -e "\n5. Verifying progression reset:"
curl -s "$API_URL/progression" | jq '{
    mode: .data.mode,
    currentLevel: .data.currentLevel,
    unlockedCapabilities: .data.unlockedCapabilities
}'

echo -e "\n✅ Test completed!"