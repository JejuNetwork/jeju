#!/bin/bash

echo "🧪 Running Tauri Runtime Tests..."

# Detect container runtime (Podman preferred)
if command -v podman &> /dev/null; then
    RUNTIME="podman"
elif command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    RUNTIME="docker"
else
    echo "❌ Neither Podman nor Docker found. Please install Podman or Docker."
    exit 1
fi

echo "Using container runtime: $RUNTIME"

# Ensure containers are running
echo "Checking if containers are running..."
if ! $RUNTIME ps | grep -q "eliza-agent"; then
    echo "❌ Agent container is not running. Please start it first with 'bun run dev'"
    exit 1
fi

# Run the Tauri tests with the environment variable set
cd src-tauri
RUN_TAURI_TESTS=true cargo run --release

# Capture the exit code
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All Tauri runtime tests passed!"
else
    echo "❌ Tauri runtime tests failed with exit code: $EXIT_CODE"
fi

exit $EXIT_CODE