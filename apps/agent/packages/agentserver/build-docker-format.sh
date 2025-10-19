#!/bin/bash

# Build script that ensures Docker format is used with Podman for HEALTHCHECK support

set -e

echo "🔨 Building eliza-agent container in Docker format (for HEALTHCHECK support)..."

# Change to the agentserver directory
cd "$(dirname "$0")"

# Set BUILDAH_FORMAT to docker for this build
export BUILDAH_FORMAT=docker

# Check if we're using podman or docker
if command -v podman &> /dev/null; then
    echo "Using Podman with Docker format..."
    # Build with Docker format explicitly
    podman build --format docker -f Dockerfile -t agentserver_eliza-agent:latest ../.. "$@"
elif command -v docker &> /dev/null; then
    echo "Using Docker..."
    docker build -f Dockerfile -t agentserver_eliza-agent:latest ../.. "$@"
else
    echo "Error: Neither podman nor docker found!"
    exit 1
fi

echo "✅ Build complete with Docker format (HEALTHCHECK enabled)"