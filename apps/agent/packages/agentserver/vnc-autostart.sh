#!/bin/bash

# VNC Auto-start Script for ElizaOS Agent
# This script sets up a default terminal environment in the VNC display

echo "[VNC] Setting up default terminal environment..."

# Ensure DISPLAY is set
export DISPLAY=:99

# Wait for X server to be ready
echo "[VNC] Waiting for X server..."
# Give X server time to start
sleep 2
if pgrep Xvfb > /dev/null; then
    echo "[VNC] X server is ready"
else
    echo "[VNC] Warning: X server may not be ready yet"
fi

# Wait for window manager to be ready
echo "[VNC] Waiting for window manager..."
for i in {1..10}; do
    if pgrep fluxbox > /dev/null; then
        echo "[VNC] Window manager is ready"
        break
    fi
    echo "[VNC] Waiting for window manager... ($i/10)"
    sleep 1
done

# Skip setting background color as xsetroot may not be available
echo "[VNC] Skipping background color (xsetroot not available)"

# Create a tmux configuration if it doesn't exist
if [ ! -f ~/.tmux.conf ]; then
    cat > ~/.tmux.conf << 'EOF'
# ElizaOS tmux configuration
set -g default-terminal "xterm-256color"
set -g mouse on
set -g history-limit 10000

# Status bar customization
set -g status-bg black
set -g status-fg white
set -g status-left '#[fg=green][ElizaOS] '
set -g status-right '#[fg=yellow]%H:%M:%S'
set -g status-interval 1

# Pane borders
set -g pane-border-style fg=colour235
set -g pane-active-border-style fg=colour245

# Window titles
set -g window-status-format '#I:#W'
set -g window-status-current-format '#[fg=cyan,bold]#I:#W'

# Enable UTF-8
set -gq status-utf8 on
set -gq utf8 on

# Better key bindings
bind | split-window -h
bind - split-window -v
unbind '"'
unbind %
EOF
fi

# Create persistent demo content window that stays visible
echo "[VNC] Creating persistent demo window..."
cat > /tmp/vnc_demo.sh << 'EOF'
#!/bin/bash
# Persistent VNC demo content
while true; do
    clear
    echo "================================="
    echo "   ElizaOS Agent VNC Display"
    echo "================================="
    echo ""
    echo "Time: $(date)"
    echo "Display: $DISPLAY"
    echo "Agent Status: Active"
    echo ""
    echo "This is the agent's virtual desktop."
    echo "Any GUI applications will appear here."
    echo ""
    echo "Available capabilities:"
    echo "- Browser automation (Stagehand)"
    echo "- Desktop applications"
    echo "- Screen capture for vision"
    echo ""
    echo "Waiting for GUI applications..."
    echo ""
    echo "================================="
    sleep 1
done
EOF
chmod +x /tmp/vnc_demo.sh

# Start persistent demo window
xterm -hold -geometry 140x40+100+100 \
    -fa 'Monospace' -fs 12 \
    -bg black -fg white \
    -title "ElizaOS Agent Desktop" \
    -e "/tmp/vnc_demo.sh" &

# Create a visual indicator panel
echo "[VNC] Creating status panel..."
cat > /tmp/status_panel.sh << 'EOF'
#!/bin/bash
while true; do
    clear
    echo "=== Agent Status ==="
    echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)%"
    echo "Memory: $(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
    echo "Processes: $(ps aux | wc -l)"
    echo ""
    echo "=== Media Streams ==="
    echo "VNC: Active on :5900"
    echo "Display: $DISPLAY"
    echo "Resolution: 1280x720"
    echo ""
    echo "=== Recent Activity ==="
    tail -n 5 /app/logs/*.log 2>/dev/null | head -5 || echo "No activity yet"
    sleep 2
done
EOF
chmod +x /tmp/status_panel.sh

# Start status panel
xterm -hold -geometry 80x20+10+10 \
    -fa 'Monospace' -fs 10 \
    -bg '#1a1a1a' -fg '#00ff00' \
    -title "System Status" \
    -e "/tmp/status_panel.sh" &

# Give xterm time to start
sleep 2

# Create a browser launch script for headful Stagehand
echo "[VNC] Creating browser launcher..."
cat > /tmp/launch_browser.sh << 'EOF'
#!/bin/bash
# Check if Chrome/Chromium is installed
if command -v google-chrome &> /dev/null; then
    BROWSER="google-chrome"
elif command -v chromium &> /dev/null; then
    BROWSER="chromium"
elif command -v chromium-browser &> /dev/null; then
    BROWSER="chromium-browser"
else
    echo "No Chrome/Chromium found. Installing..."
    apt-get update && apt-get install -y chromium
    BROWSER="chromium"
fi

# Launch browser in the virtual display
echo "Launching browser on display $DISPLAY..."
$BROWSER --no-sandbox --disable-gpu --display=$DISPLAY --start-maximized "https://www.example.com" &
EOF
chmod +x /tmp/launch_browser.sh

# List created windows
echo "[VNC] Terminal windows created:"
sleep 1
ps aux | grep xterm | grep -v grep | wc -l | xargs echo "  - Total xterm windows:"
ps aux | grep tmux | grep -v grep | wc -l | xargs echo "  - Tmux sessions:"

echo "[VNC] VNC terminal environment setup complete!" 