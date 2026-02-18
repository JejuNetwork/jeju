#!/bin/bash
# Anvil with automatic state saving every 10 minutes
# Usage: ./anvil-with-autosave.sh

STATE_DIR="$HOME/jeju-anvil-state"
STATE_FILE="$STATE_DIR/anvil-state.json"
BACKUP_DIR="$STATE_DIR/backups"
PORT=6546
CHAIN_ID=31337

mkdir -p "$STATE_DIR" "$BACKUP_DIR"

# Function to save state
save_state() {
    if curl -s http://localhost:$PORT > /dev/null 2>&1; then
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)

        # Dump current state
        ~/.foundry/bin/cast rpc anvil_dumpState --rpc-url http://localhost:$PORT 2>/dev/null | jq -r '.' > "$STATE_FILE.tmp"

        if [ -s "$STATE_FILE.tmp" ]; then
            mv "$STATE_FILE.tmp" "$STATE_FILE"
            cp "$STATE_FILE" "$BACKUP_DIR/anvil-state-$TIMESTAMP.json"

            # Keep only last 15 backups
            ls -t "$BACKUP_DIR"/anvil-state-*.json 2>/dev/null | tail -n +16 | xargs -r rm

            echo "[$(date)] State saved to $STATE_FILE"
        else
            rm -f "$STATE_FILE.tmp"
            echo "[$(date)] Warning: Failed to dump state"
        fi
    fi
}

# Function to start anvil
start_anvil() {
    echo "Starting Anvil on port $PORT..."

    # Check if we have a saved state to load
    if [ -f "$STATE_FILE" ] && [ -s "$STATE_FILE" ]; then
        echo "Loading saved state from $STATE_FILE"
        ~/.foundry/bin/anvil \
            --host 0.0.0.0 \
            --port $PORT \
            --chain-id $CHAIN_ID \
            --load-state "$STATE_FILE" &
    else
        echo "Starting fresh anvil (no saved state found)"
        ~/.foundry/bin/anvil \
            --host 0.0.0.0 \
            --port $PORT \
            --chain-id $CHAIN_ID &
    fi

    ANVIL_PID=$!
    echo "Anvil started with PID $ANVIL_PID"

    # Wait for anvil to be ready
    for i in {1..30}; do
        if curl -s http://localhost:$PORT > /dev/null 2>&1; then
            echo "Anvil is ready!"
            break
        fi
        sleep 1
    done
}

# Trap to save state on exit
cleanup() {
    echo "Shutting down... saving final state"
    save_state
    kill $ANVIL_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start anvil
start_anvil

# Auto-save loop (every 10 minutes)
while true; do
    sleep 600  # 10 minutes
    save_state
done
