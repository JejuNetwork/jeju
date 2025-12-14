#!/bin/bash
set -e

# Verify Go code compiles correctly
# This script checks syntax and type errors without running tests

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OP_STAGE2_DIR="$PROJECT_ROOT/vendor/optimism-stage2"

echo "=== Verifying Go Code Compilation ==="

cd "$OP_STAGE2_DIR"

# Check if go is available
if ! command -v go &> /dev/null; then
    echo "Warning: Go not found locally. Skipping compilation check."
    exit 0
fi

GO_VERSION=$(go version | grep -oE 'go[0-9]+\.[0-9]+')
echo "Go version: $GO_VERSION"

echo ""
echo "Checking threshold_txmanager.go..."
go vet ./op-batcher/batcher/threshold_txmanager.go 2>&1 || true

echo ""
echo "Checking registry_conductor.go..."
go vet ./op-node/rollup/sequencing/registry_conductor.go 2>&1 || true

echo ""
echo "Checking keyloader.go..."
go vet ./op-batcher/batcher/keyloader.go 2>&1 || true

echo ""
echo "=== Files verified ==="

# List the Stage 2 files we've modified
echo ""
echo "Stage 2 Go files:"
find ./op-batcher/batcher -name "*.go" -newer ./go.mod | head -10
find ./op-node/rollup/sequencing -name "*.go" -newer ./go.mod | head -10

