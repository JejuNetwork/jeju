#!/bin/bash

echo "[STARTUP] ElizaOS Agent Server starting..."

# Export DISPLAY environment variable
export DISPLAY=:99
echo "[STARTUP] Display set to $DISPLAY"

# Verify display services are running
echo "[STARTUP] Verifying display services..."
sleep 2  # Give services time to start from entrypoint

if pgrep Xvfb > /dev/null; then
    echo "[STARTUP] ✓ Xvfb display server is running"
else
    echo "[STARTUP] ✗ WARNING: Xvfb not running!"
fi

if pgrep x11vnc > /dev/null; then
    echo "[STARTUP] ✓ VNC server is running on port 5900"
else
    echo "[STARTUP] ✗ WARNING: VNC server not running!"
fi

# Start VNC terminal environment if script exists
if [ -f "/app/vnc-autostart.sh" ]; then
    echo "[STARTUP] Starting VNC terminal environment..."
    bash /app/vnc-autostart.sh &
    sleep 3  # Give terminals time to start
    echo "[STARTUP] VNC terminals started"
fi

# Run display verification if script exists
if [ -f "/app/verify-display.sh" ]; then
    echo "[STARTUP] Running display verification..."
    bash /app/verify-display.sh
fi

# Check if database reset is requested
if [ "$RESET_DB" = "true" ]; then
    echo "[STARTUP] Database reset requested (RESET_DB=true)"
    
    # Wait for PostgreSQL to be available
    echo "[STARTUP] Waiting for PostgreSQL to be ready..."
    until PGPASSWORD=eliza_secure_pass psql -h eliza-postgres -U eliza -d postgres -c '\q' 2>/dev/null; do
        echo "[STARTUP] PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    
    echo "[STARTUP] PostgreSQL is ready - resetting database"
    
    # Drop and recreate the database
    PGPASSWORD=eliza_secure_pass psql -h eliza-postgres -U eliza -d postgres <<EOF
DROP DATABASE IF EXISTS eliza;
CREATE DATABASE eliza;
EOF
    
    echo "[STARTUP] Database created - installing extensions"
    
    # Install required extensions in the new database
    PGPASSWORD=eliza_secure_pass psql -h eliza-postgres -U eliza -d eliza <<EOF
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch";
EOF
    
    echo "[STARTUP] Database reset complete with extensions"
else
    echo "[STARTUP] Keeping existing database (RESET_DB=false)"
fi

# Start the server
echo "[STARTUP] Starting ElizaOS server..."
exec ./server 