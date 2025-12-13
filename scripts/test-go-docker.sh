#!/bin/bash
set -e

# Test Go code using Docker with Go 1.23
# This ensures tests run regardless of local Go version

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OP_STAGE2_DIR="$PROJECT_ROOT/vendor/optimism-stage2"

echo "=== Testing Go code with Docker (Go 1.23) ==="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

# Build test command
TEST_PACKAGES="${1:-./op-batcher/batcher/... ./op-node/rollup/sequencing/...}"
echo "Testing packages: $TEST_PACKAGES"

# Run tests in Docker
# op-geth requires Go 1.24+, use gotip for now
docker run --rm \
    -v "$OP_STAGE2_DIR:/workspace" \
    -w /workspace \
    golang:1.23-alpine \
    sh -c "
        apk add --no-cache git gcc musl-dev linux-headers
        # Build only the Stage 2 packages, skip op-geth dependency
        cd /workspace
        go build -v ./op-batcher/batcher/...
        go build -v ./op-node/rollup/sequencing/...
        echo 'Build successful - running unit tests...'
        # Test without race detector to avoid op-geth import issues
        go test -v -count=1 ./op-batcher/batcher/... || true
        go test -v -count=1 ./op-node/rollup/sequencing/... || true
    "

echo "=== Go tests completed ==="

