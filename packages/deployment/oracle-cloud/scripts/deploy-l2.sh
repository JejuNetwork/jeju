#!/bin/bash
#
# Jeju L2 Deployment Script for Oracle Cloud
#
# This script deploys a complete OP Stack L2:
# 1. L1: Geth in --dev mode (NOT Anvil - avoids block hash issues)
# 2. L1 Contracts: via op-deployer
# 3. L2: op-geth (latest) + op-node v1.11.0 (ARM64 compatible versions)
#
# Prerequisites:
# - Docker installed
# - At least 8GB RAM
# - Ports 8545, 8546, 8551, 9545 available
#
# ARM64 (Oracle Cloud Ampere) compatible

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/.."
DATA_DIR="$HOME/l2-data"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[JEJU]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Configuration
# NOTE: Geth --dev mode uses chain ID 1337 by default
L1_CHAIN_ID=1337
L2_CHAIN_ID=2151908
L1_RPC_PORT=8545
L2_RPC_PORT=9545
L2_ENGINE_PORT=8551

# Anvil/Foundry default accounts
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# ============================================================================
# Step 1: Setup directories
# ============================================================================
setup_directories() {
    log "Setting up directories..."
    mkdir -p "$DATA_DIR"/{l1,l2,config,jwt}

    # Generate JWT secret
    if [ ! -f "$DATA_DIR/jwt/jwt.hex" ]; then
        openssl rand -hex 32 > "$DATA_DIR/jwt/jwt.hex"
        log "Generated JWT secret"
    fi
}

# ============================================================================
# Step 2: Start L1 Geth (--dev mode)
# ============================================================================
start_l1() {
    log "Starting L1 Geth in dev mode..."

    # Stop existing L1 if running
    docker stop jeju-l1-geth 2>/dev/null || true
    docker rm jeju-l1-geth 2>/dev/null || true

    # Use ethereum/client-go with --dev mode
    # This creates a single-node chain with instant mining
    # NOTE: --dev mode uses chain ID 1337 by default
    docker run -d \
        --name jeju-l1-geth \
        --network host \
        -v "$DATA_DIR/l1:/data" \
        -v "$DATA_DIR/jwt:/jwt:ro" \
        ethereum/client-go:v1.14.12 \
        --dev \
        --dev.period=2 \
        --datadir=/data \
        --http \
        --http.addr=0.0.0.0 \
        --http.port=$L1_RPC_PORT \
        --http.api=eth,net,web3,debug,personal,admin,txpool,engine \
        --http.corsdomain='*' \
        --http.vhosts='*' \
        --ws \
        --ws.addr=0.0.0.0 \
        --ws.port=8546 \
        --ws.api=eth,net,web3,debug \
        --ws.origins='*' \
        --authrpc.addr=0.0.0.0 \
        --authrpc.port=8551 \
        --authrpc.vhosts='*' \
        --authrpc.jwtsecret=/jwt/jwt.hex \
        --nodiscover \
        --maxpeers=0

    log "Waiting for L1 to be ready..."
    for i in {1..30}; do
        if curl -s -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            http://localhost:$L1_RPC_PORT 2>/dev/null | grep -q result; then
            log "L1 Geth is ready!"
            return 0
        fi
        sleep 2
    done
    error "L1 failed to start"
}

# ============================================================================
# Step 3: Fund deployer account on L1
# ============================================================================
fund_deployer() {
    log "Funding deployer account..."

    # In --dev mode, the coinbase is pre-funded
    # We need to send ETH from the dev account to our deployer
    # The dev account private key is deterministic in geth --dev

    # Check if deployer already has funds
    BALANCE=$(curl -s -X POST -H "Content-Type: application/json" \
        --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER_ADDRESS\",\"latest\"],\"id\":1}" \
        http://localhost:$L1_RPC_PORT | jq -r '.result')

    if [ "$BALANCE" != "0x0" ] && [ -n "$BALANCE" ]; then
        log "Deployer already funded: $BALANCE"
        return 0
    fi

    # Fund via personal_sendTransaction (dev mode allows unsigned txs from coinbase)
    # In geth --dev, account[0] is the coinbase with unlimited ETH
    curl -s -X POST -H "Content-Type: application/json" \
        --data "{
            \"jsonrpc\":\"2.0\",
            \"method\":\"eth_sendTransaction\",
            \"params\":[{
                \"from\":\"0x0000000000000000000000000000000000000000\",
                \"to\":\"$DEPLOYER_ADDRESS\",
                \"value\":\"0x21e19e0c9bab2400000\"
            }],
            \"id\":1
        }" \
        http://localhost:$L1_RPC_PORT || true

    # Alternative: Use the dev account unlock + send
    # The dev account address can be retrieved via eth_accounts
    DEV_ACCOUNT=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' \
        http://localhost:$L1_RPC_PORT | jq -r '.result[0]')

    if [ -n "$DEV_ACCOUNT" ] && [ "$DEV_ACCOUNT" != "null" ]; then
        log "Using dev account: $DEV_ACCOUNT"
        curl -s -X POST -H "Content-Type: application/json" \
            --data "{
                \"jsonrpc\":\"2.0\",
                \"method\":\"eth_sendTransaction\",
                \"params\":[{
                    \"from\":\"$DEV_ACCOUNT\",
                    \"to\":\"$DEPLOYER_ADDRESS\",
                    \"value\":\"0x21e19e0c9bab2400000\"
                }],
                \"id\":1
            }" \
            http://localhost:$L1_RPC_PORT
    fi

    sleep 3
    log "Deployer funded"
}

# ============================================================================
# Step 4: Deploy L1 contracts via op-deployer
# ============================================================================
deploy_l1_contracts() {
    log "Deploying L1 contracts with op-deployer..."

    # Create intent.toml for op-deployer
    cat > "$DATA_DIR/config/intent.toml" << EOF
configType = "custom"

l1ChainID = $L1_CHAIN_ID
fundDevAccounts = true
l1ContractsLocator = "tag://op-contracts/v1.6.0"
l2ContractsLocator = "tag://op-contracts/v1.6.0"

[superchainRoles]
  SuperchainProxyAdminOwner = "$DEPLOYER_ADDRESS"
  SuperchainGuardian = "$DEPLOYER_ADDRESS"
  SuperchainProtocolVersionsOwner = "$DEPLOYER_ADDRESS"

[[chains]]
  id = "$L2_CHAIN_ID"
  baseFeeVaultRecipient = "$DEPLOYER_ADDRESS"
  l1FeeVaultRecipient = "$DEPLOYER_ADDRESS"
  sequencerFeeVaultRecipient = "$DEPLOYER_ADDRESS"
  eip1559DenominatorCanyon = 250
  eip1559Denominator = 50
  eip1559Elasticity = 6
  [chains.roles]
    l1ProxyAdminOwner = "$DEPLOYER_ADDRESS"
    l2ProxyAdminOwner = "$DEPLOYER_ADDRESS"
    systemConfigOwner = "$DEPLOYER_ADDRESS"
    unsafeBlockSigner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    batcher = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
    proposer = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
    challenger = "$DEPLOYER_ADDRESS"
EOF

    # Run op-deployer
    docker run --rm \
        --network host \
        -v "$DATA_DIR/config:/config" \
        -e OP_DEPLOYER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-deployer:latest \
        apply \
        --l1-rpc-url=http://localhost:$L1_RPC_PORT \
        --workdir=/config

    log "L1 contracts deployed!"

    # Copy generated files
    if [ -f "$DATA_DIR/config/genesis.json" ]; then
        cp "$DATA_DIR/config/genesis.json" "$DATA_DIR/l2/genesis.json"
    fi
    if [ -f "$DATA_DIR/config/rollup.json" ]; then
        cp "$DATA_DIR/config/rollup.json" "$DATA_DIR/l2/rollup.json"
    fi
}

# ============================================================================
# Step 5: Initialize op-geth with genesis
# ============================================================================
init_l2() {
    log "Initializing op-geth..."

    # Stop existing if running
    docker stop jeju-op-geth 2>/dev/null || true
    docker rm jeju-op-geth 2>/dev/null || true

    # Clear existing data
    rm -rf "$DATA_DIR/l2/geth"

    # Initialize with genesis - use :latest for ARM64 compatibility
    # Use --state.scheme=hash to avoid path/hash state scheme conflicts
    docker run --rm \
        -v "$DATA_DIR/l2:/data" \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest \
        init --datadir=/data --state.scheme=hash /data/genesis.json

    log "op-geth initialized with genesis"
}

# ============================================================================
# Step 6: Start op-geth
# ============================================================================
start_l2_geth() {
    log "Starting op-geth..."

    docker stop jeju-op-geth 2>/dev/null || true
    docker rm jeju-op-geth 2>/dev/null || true

    # Use :latest for ARM64 compatibility (Oracle Cloud Ampere)
    docker run -d \
        --name jeju-op-geth \
        --network host \
        -v "$DATA_DIR/l2:/data" \
        -v "$DATA_DIR/jwt:/jwt:ro" \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest \
        --datadir=/data \
        --http \
        --http.addr=0.0.0.0 \
        --http.port=$L2_RPC_PORT \
        --http.api=eth,net,web3,debug,txpool,engine \
        --http.corsdomain='*' \
        --http.vhosts='*' \
        --ws \
        --ws.addr=0.0.0.0 \
        --ws.port=9546 \
        --ws.api=eth,net,web3,debug \
        --ws.origins='*' \
        --authrpc.addr=0.0.0.0 \
        --authrpc.port=$L2_ENGINE_PORT \
        --authrpc.vhosts='*' \
        --authrpc.jwtsecret=/jwt/jwt.hex \
        --syncmode=full \
        --gcmode=archive \
        --nodiscover \
        --maxpeers=0 \
        --networkid=$L2_CHAIN_ID \
        --rollup.sequencerhttp=http://localhost:$L2_RPC_PORT \
        --rollup.disabletxpoolgossip

    log "Waiting for op-geth..."
    for i in {1..30}; do
        if curl -s -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            http://localhost:$L2_RPC_PORT 2>/dev/null | grep -q result; then
            log "op-geth is ready!"
            return 0
        fi
        sleep 2
    done
    error "op-geth failed to start"
}

# ============================================================================
# Step 7: Start op-node
# ============================================================================
start_l2_node() {
    log "Starting op-node..."

    docker stop jeju-op-node 2>/dev/null || true
    docker rm jeju-op-node 2>/dev/null || true

    # Use v1.11.0 for ARM64 compatibility (Oracle Cloud Ampere)
    docker run -d \
        --name jeju-op-node \
        --network host \
        -v "$DATA_DIR/l2:/data" \
        -v "$DATA_DIR/jwt:/jwt:ro" \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.11.0 \
        op-node \
        --l1=http://localhost:$L1_RPC_PORT \
        --l2=http://localhost:$L2_ENGINE_PORT \
        --l2.jwt-secret=/jwt/jwt.hex \
        --rollup.config=/data/rollup.json \
        --rpc.addr=0.0.0.0 \
        --rpc.port=7545 \
        --p2p.disable \
        --sequencer.enabled \
        --sequencer.l1-confs=0 \
        --verifier.l1-confs=0 \
        --l1.trustrpc \
        --log.level=info

    log "op-node started"

    # Check logs for errors
    sleep 5
    docker logs jeju-op-node 2>&1 | tail -20
}

# ============================================================================
# Step 8: Start op-batcher
# ============================================================================
start_batcher() {
    log "Starting op-batcher..."

    docker stop jeju-op-batcher 2>/dev/null || true
    docker rm jeju-op-batcher 2>/dev/null || true

    # Batcher private key (Anvil account #2)
    BATCHER_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

    # Use :latest for ARM64 compatibility (Oracle Cloud Ampere)
    docker run -d \
        --name jeju-op-batcher \
        --network host \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher:latest \
        op-batcher \
        --l1-eth-rpc=http://localhost:$L1_RPC_PORT \
        --l2-eth-rpc=http://localhost:$L2_RPC_PORT \
        --rollup-rpc=http://localhost:7545 \
        --poll-interval=1s \
        --sub-safety-margin=6 \
        --num-confirmations=1 \
        --safe-abort-nonce-too-low-count=3 \
        --resubmission-timeout=30s \
        --rpc.addr=0.0.0.0 \
        --rpc.port=6545 \
        --private-key=$BATCHER_KEY \
        --log.level=info

    log "op-batcher started"
}

# ============================================================================
# Main
# ============================================================================
main() {
    log "=========================================="
    log "  Jeju L2 Deployment"
    log "  L1 Chain ID: $L1_CHAIN_ID"
    log "  L2 Chain ID: $L2_CHAIN_ID"
    log "=========================================="

    setup_directories
    start_l1
    fund_deployer
    deploy_l1_contracts
    init_l2
    start_l2_geth
    start_l2_node
    start_batcher

    log ""
    log "=========================================="
    log "  DEPLOYMENT COMPLETE"
    log "=========================================="
    log ""
    log "L1 RPC: http://localhost:$L1_RPC_PORT"
    log "L2 RPC: http://localhost:$L2_RPC_PORT"
    log "Op-Node RPC: http://localhost:7545"
    log ""
    log "Check status:"
    log "  docker logs jeju-op-node -f"
    log "  curl -s localhost:$L2_RPC_PORT -X POST -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}'"
    log ""
}

# Run if called directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
