#!/bin/bash
set -e

# Test Go code using Docker with Go 1.23
# This ensures tests run regardless of local Go version

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OP_DECENTRALIZED_DIR="$PROJECT_ROOT/vendor/optimism-decentralized"

echo "=== Testing Go code with Docker (Go 1.23) ==="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

# Build test command
TEST_PACKAGES="${1:-./op-batcher/batcher/... ./op-node/rollup/sequencing/...}"
echo "Testing packages: $TEST_PACKAGES"

# Run tests in Docker with Go 1.24
docker run --rm \
    -v "$OP_DECENTRALIZED_DIR:/workspace" \
    -w /workspace \
    golang:1.24 \
    sh -c "
        apt-get update && apt-get install -y git gcc
        cd /workspace
        echo '=== Tidying Go modules ==='
        go mod tidy
        echo '=== Building Decentralization packages ==='
        go build -v ./op-batcher/batcher/...
        go build -v ./op-node/rollup/sequencing/...
        echo '=== Running Decentralization tests ==='
        go test -v -count=1 ./op-batcher/batcher/...
        go test -v -count=1 ./op-node/rollup/sequencing/...
    "

echo "=== Go tests completed ==="

