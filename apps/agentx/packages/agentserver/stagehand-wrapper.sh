#!/bin/bash
# Wrapper script to ensure Stagehand server runs with proper display configuration

echo "[StagehandWrapper] Starting with DISPLAY=$DISPLAY"

# Export display settings explicitly
export DISPLAY=${DISPLAY:-:99}
export BROWSER_HEADLESS=${BROWSER_HEADLESS:-false}

# Wait for X11 display to be available
echo "[StagehandWrapper] Checking X11 display availability..."
for i in {1..10}; do
    if xdpyinfo -display $DISPLAY >/dev/null 2>&1; then
        echo "[StagehandWrapper] X11 display $DISPLAY is available"
        break
    else
        echo "[StagehandWrapper] Waiting for X11 display... attempt $i/10"
        sleep 1
    fi
done

# Ensure Xauthority is set if needed
if [ -z "$XAUTHORITY" ]; then
    export XAUTHORITY=/home/eliza/.Xauthority
    touch $XAUTHORITY
fi

# Run the actual Stagehand server binary
echo "[StagehandWrapper] Starting Stagehand server with display: $DISPLAY"
exec /usr/local/bin/stagehand-server-orig "$@"