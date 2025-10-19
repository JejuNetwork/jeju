#!/bin/sh
# Health check script for agent container

# Check if the server is responding on port 7777
if curl -f -s http://localhost:7777/api/server/health > /dev/null 2>&1; then
    echo "Agent server is healthy"
    exit 0
else
    echo "Agent server health check failed"
    exit 1
fi