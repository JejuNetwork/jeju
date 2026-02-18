#!/bin/bash
# Jeju L2 Genesis Initialization Script
#
# This script initializes the rollup.json with actual L1 and L2 genesis hashes
# and sets up proper timestamps.
#
# IMPORTANT: Run this script in two phases:
#   1. After L1 starts (to get L1 hash)
#   2. After op-geth starts (to get L2 hash)
#
# Usage:
#   Phase 1: ./init-genesis.sh phase1     # After L1 is up
#   Phase 2: ./init-genesis.sh phase2     # After op-geth is up
#   Full:    ./init-genesis.sh            # Interactive mode

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../docker/config"
ROLLUP_JSON="$CONFIG_DIR/rollup.json"
GENESIS_JSON="$CONFIG_DIR/genesis.json"

L1_RPC="${L1_RPC:-http://localhost:8545}"
L2_RPC="${L2_RPC:-http://localhost:9545}"

echo "=== Jeju L2 Genesis Initialization ==="
echo "L1 RPC: $L1_RPC"
echo "L2 RPC: $L2_RPC"
echo ""

# Function to wait for RPC
wait_for_rpc() {
    local rpc_url=$1
    local name=$2
    echo "Waiting for $name to be ready..."
    for i in {1..30}; do
        if curl -s "$rpc_url" -X POST -H 'Content-Type: application/json' \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
            echo "$name is ready!"
            return 0
        fi
        echo "Waiting... ($i/30)"
        sleep 2
    done
    echo "ERROR: $name not responding"
    return 1
}

# Function to get block hash
get_block_hash() {
    local rpc_url=$1
    curl -s "$rpc_url" -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x0",false],"id":1}' \
        | grep -o '"hash":"0x[a-fA-F0-9]*"' | head -1 | cut -d'"' -f4
}

# Phase 1: Initialize with L1 hash
phase1() {
    wait_for_rpc "$L1_RPC" "L1"

    echo ""
    echo "Fetching L1 genesis block hash..."
    L1_HASH=$(get_block_hash "$L1_RPC")

    if [ -z "$L1_HASH" ] || [ "$L1_HASH" = "null" ]; then
        echo "ERROR: Could not fetch L1 genesis hash"
        exit 1
    fi
    echo "L1 Genesis Hash: $L1_HASH"

    # Get current timestamp
    CURRENT_TIME=$(date +%s)
    TIMESTAMP_HEX=$(printf '0x%x' $CURRENT_TIME)
    echo "L2 Genesis Time: $CURRENT_TIME ($TIMESTAMP_HEX)"

    # Update rollup.json with L1 hash and timestamp
    echo ""
    echo "Updating rollup.json..."

    if command -v python3 &> /dev/null; then
        python3 << PYEOF
import json

with open('$ROLLUP_JSON', 'r') as f:
    rollup = json.load(f)

rollup['genesis']['l1']['hash'] = '$L1_HASH'
rollup['genesis']['l2_time'] = $CURRENT_TIME

with open('$ROLLUP_JSON', 'w') as f:
    json.dump(rollup, f, indent=2)

print('Updated rollup.json with L1 hash and timestamp')
PYEOF
    else
        # Fallback to sed
        sed -i.bak "s|\"hash\": \"0x[a-fA-F0-9]*\"|\"hash\": \"$L1_HASH\"|" "$ROLLUP_JSON"
        sed -i.bak "s|\"l2_time\": [0-9]*|\"l2_time\": $CURRENT_TIME|" "$ROLLUP_JSON"
        rm -f "$ROLLUP_JSON.bak"
    fi

    # Update genesis.json timestamp
    echo "Updating genesis.json timestamp..."
    if command -v python3 &> /dev/null; then
        python3 << PYEOF
import json

with open('$GENESIS_JSON', 'r') as f:
    genesis = json.load(f)

genesis['timestamp'] = '$TIMESTAMP_HEX'

with open('$GENESIS_JSON', 'w') as f:
    json.dump(genesis, f, indent=2)

print('Updated genesis.json timestamp')
PYEOF
    else
        sed -i.bak "s|\"timestamp\": \"0x[a-fA-F0-9]*\"|\"timestamp\": \"$TIMESTAMP_HEX\"|" "$GENESIS_JSON"
        rm -f "$GENESIS_JSON.bak"
    fi

    echo ""
    echo "=== Phase 1 Complete ==="
    echo "L1 Hash: $L1_HASH"
    echo "L2 Time: $CURRENT_TIME"
    echo ""
    echo "Next: Start op-geth, then run: $0 phase2"
}

# Phase 2: Update with L2 hash
phase2() {
    wait_for_rpc "$L2_RPC" "L2 (op-geth)"

    echo ""
    echo "Fetching L2 genesis block hash..."
    L2_HASH=$(get_block_hash "$L2_RPC")

    if [ -z "$L2_HASH" ] || [ "$L2_HASH" = "null" ]; then
        echo "ERROR: Could not fetch L2 genesis hash"
        exit 1
    fi
    echo "L2 Genesis Hash: $L2_HASH"

    # Update rollup.json with L2 hash
    echo ""
    echo "Updating rollup.json with L2 hash..."

    if command -v python3 &> /dev/null; then
        python3 << PYEOF
import json

with open('$ROLLUP_JSON', 'r') as f:
    rollup = json.load(f)

rollup['genesis']['l2']['hash'] = '$L2_HASH'

with open('$ROLLUP_JSON', 'w') as f:
    json.dump(rollup, f, indent=2)

print('Updated rollup.json with L2 hash')
PYEOF
    else
        # This is tricky with sed - need to update only the L2 hash
        echo "WARNING: python3 not found, manual L2 hash update may be needed"
    fi

    echo ""
    echo "=== Phase 2 Complete ==="
    echo "L2 Hash: $L2_HASH"
    echo ""
    echo "Configuration complete! You can now start op-node."
}

# Main
case "${1:-}" in
    phase1)
        phase1
        ;;
    phase2)
        phase2
        ;;
    *)
        echo "Running full initialization..."
        echo ""
        echo "Make sure:"
        echo "  1. L1 (l1-geth) is running"
        echo "  2. op-geth is NOT running yet"
        echo ""
        read -p "Press Enter to continue with Phase 1..."
        phase1
        echo ""
        echo "Now start op-geth:"
        echo "  cd ../docker && docker compose up -d op-geth"
        echo ""
        read -p "Press Enter after op-geth is running to continue with Phase 2..."
        phase2
        echo ""
        echo "=== Full Initialization Complete ==="
        echo "You can now start op-node:"
        echo "  cd ../docker && docker compose up -d op-node"
        ;;
esac
