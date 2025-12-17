#!/bin/bash
set -e

# ZKSolBridge Docker Entrypoint
# Validates environment and starts the appropriate service

# Required environment variables
REQUIRED_VARS="EVM_RPC_URL SOLANA_RPC_URL"

# Check required variables
for var in $REQUIRED_VARS; do
    if [ -z "${!var}" ]; then
        echo "ERROR: Required environment variable $var is not set"
        exit 1
    fi
done

# Set defaults
export PORT=${PORT:-8081}
export LOG_LEVEL=${LOG_LEVEL:-info}
export NODE_ENV=${NODE_ENV:-production}

# Handle different service modes
case "$1" in
    relayer)
        echo "Starting ZKSolBridge Relayer..."
        exec bun run dist/relayer/service.js
        ;;
    prover)
        echo "Starting ZKSolBridge Prover..."
        exec bun run dist/prover/service.js
        ;;
    xlp)
        echo "Starting XLP Service..."
        exec bun run dist/xlp/service.js
        ;;
    health)
        echo "Health check mode - testing endpoints..."
        curl -sf http://localhost:${PORT}/monitoring/health && echo "OK" || exit 1
        ;;
    *)
        # Default: run relayer
        echo "Starting ZKSolBridge Relayer (default)..."
        exec bun run dist/relayer/service.js
        ;;
esac

