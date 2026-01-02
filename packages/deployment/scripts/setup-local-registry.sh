#!/usr/bin/env bash
#
# Setup script for local development with registry.jeju
#
# This script:
# 1. Adds registry.jeju to /etc/hosts
# 2. Starts a local Docker registry
# 3. Pulls and re-tags OP Stack images from upstream
#
# Usage: ./setup-local-registry.sh

set -euo pipefail

REGISTRY_HOST="registry.jeju"
REGISTRY_PORT="5000"
REGISTRY_URL="${REGISTRY_HOST}:${REGISTRY_PORT}"

echo "================================"
echo "Setting up local registry.jeju"
echo "================================"
echo ""

# Check if running as root for /etc/hosts
check_hosts_entry() {
    if grep -q "${REGISTRY_HOST}" /etc/hosts; then
        echo "[OK] ${REGISTRY_HOST} already in /etc/hosts"
        return 0
    fi
    return 1
}

add_hosts_entry() {
    echo "[INFO] Adding ${REGISTRY_HOST} to /etc/hosts..."
    if [ "$(id -u)" -ne 0 ]; then
        echo "[WARN] Need sudo to modify /etc/hosts"
        echo "127.0.0.1 ${REGISTRY_HOST}" | sudo tee -a /etc/hosts
    else
        echo "127.0.0.1 ${REGISTRY_HOST}" >> /etc/hosts
    fi
    echo "[OK] Added ${REGISTRY_HOST} to /etc/hosts"
}

# Start local registry container
start_registry() {
    if docker ps --format '{{.Names}}' | grep -q "^dws-registry$"; then
        echo "[OK] dws-registry container already running"
        return 0
    fi

    echo "[INFO] Starting local registry container..."
    docker run -d \
        --name dws-registry \
        --restart=always \
        -p ${REGISTRY_PORT}:5000 \
        -v dws-registry-data:/var/lib/registry \
        registry:2

    echo "[OK] Registry started at ${REGISTRY_URL}"
}

# Pull and re-tag OP Stack images
retag_images() {
    local images=(
        "op-geth:v1.101408.0"
        "op-node:v1.10.1"
        "op-batcher:v1.10.1"
        "op-proposer:v1.10.1"
        "op-conductor:v1.10.1"
        "op-challenger:v1.10.1"
    )

    echo ""
    echo "[INFO] Pulling and re-tagging OP Stack images..."
    
    for image in "${images[@]}"; do
        local name="${image%:*}"
        local tag="${image#*:}"
        local upstream="us-docker.pkg.dev/oplabs-tools-artifacts/images/${name}:${tag}"
        local local_tag="${REGISTRY_URL}/${name}:${tag}"
        
        echo "  Pulling ${upstream}..."
        docker pull "${upstream}" 2>/dev/null || {
            echo "  [WARN] Could not pull ${upstream}, skipping"
            continue
        }
        
        echo "  Tagging as ${local_tag}..."
        docker tag "${upstream}" "${local_tag}"
        
        echo "  Pushing to local registry..."
        docker push "${local_tag}" 2>/dev/null || {
            echo "  [WARN] Could not push ${local_tag}"
            continue
        }
        
        echo "  [OK] ${name}:${tag}"
    done
}

# Add geth for L1
add_geth() {
    echo ""
    echo "[INFO] Adding ethereum/client-go for L1..."
    
    local upstream="ethereum/client-go:v1.16.7"
    local local_tag="${REGISTRY_URL}/geth:v1.16.7"
    
    docker pull "${upstream}" 2>/dev/null || {
        echo "[WARN] Could not pull geth, skipping"
        return 1
    }
    
    docker tag "${upstream}" "${local_tag}"
    docker push "${local_tag}" 2>/dev/null || {
        echo "[WARN] Could not push geth"
        return 1
    }
    
    echo "[OK] geth:v1.16.7"
}

# Test registry connectivity
test_registry() {
    echo ""
    echo "[INFO] Testing registry connectivity..."
    
    if curl -s "http://${REGISTRY_URL}/v2/_catalog" > /dev/null 2>&1; then
        echo "[OK] Registry is accessible"
        echo ""
        echo "Available images:"
        curl -s "http://${REGISTRY_URL}/v2/_catalog" | jq -r '.repositories[]' 2>/dev/null || true
    else
        echo "[WARN] Registry not accessible via HTTP"
    fi
}

main() {
    # Check for docker
    if ! command -v docker &> /dev/null; then
        echo "[ERROR] Docker is required but not installed"
        exit 1
    fi

    # Setup hosts entry
    if ! check_hosts_entry; then
        add_hosts_entry
    fi

    # Start registry
    start_registry

    # Wait for registry to be ready
    sleep 2

    # Re-tag images
    retag_images
    add_geth

    # Test connectivity
    test_registry

    echo ""
    echo "================================"
    echo "Setup complete."
    echo "================================"
    echo ""
    echo "Local registry available at: ${REGISTRY_URL}"
    echo ""
    echo "To use in Kurtosis:"
    echo "  kurtosis run packages/deployment/kurtosis/decentralized-local.star \\"
    echo "    --args '{\"use_fallback_registry\": false}'"
    echo ""
}

main "$@"

