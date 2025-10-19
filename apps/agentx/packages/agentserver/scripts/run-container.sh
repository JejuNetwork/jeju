#!/bin/bash

# Detect container runtime (Docker first, then Podman)
if command -v docker &> /dev/null && docker info &> /dev/null; then
    RUNTIME="docker"
elif command -v podman &> /dev/null; then
    RUNTIME="podman"
else
    echo "❌ Neither Docker nor Podman found. Please install Docker or Podman."
    exit 1
fi

echo "🐳 Using container runtime: $RUNTIME"

# Create a network if it doesn't exist
$RUNTIME network create eliza-network 2>/dev/null || true

# Run PostgreSQL container if not already running
if ! $RUNTIME ps | grep -q eliza-postgres; then
    echo "Starting PostgreSQL container..."
    $RUNTIME run -d \
        --name eliza-postgres \
        --network eliza-network \
        -e POSTGRES_USER=eliza \
        -e POSTGRES_PASSWORD=eliza_secure_pass \
        -e POSTGRES_DB=eliza \
        -p 5432:5432 \
        -v eliza-postgres-data:/var/lib/postgresql/data \
        pgvector/pgvector:pg16
    
    # Wait for PostgreSQL to be ready
    echo "Waiting for PostgreSQL to be ready..."
    sleep 5
fi

# Run the ElizaOS agent container
echo "Starting ElizaOS agent container..."
$RUNTIME run -it \
    --rm \
    --name eliza-agent \
    --network eliza-network \
    -p 7777:7777 \
    ${1:-eliza-agent:latest}

# Note: Pass your image ID or tag as the first argument, defaults to eliza-agent:latest 