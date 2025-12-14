#!/bin/bash
#
# Deploy Jeju DAO to Base Sepolia testnet
#
# Prerequisites:
# 1. Set DEPLOYER_KEY env var (private key with Base Sepolia ETH)
# 2. Set BASESCAN_API_KEY for verification
#
# Get testnet ETH from:
# - https://www.coinbase.com/faucets/base-sepolia-faucet
# - https://faucet.chainstack.com/base-sepolia-faucet
#

set -e

if [ -z "$DEPLOYER_KEY" ]; then
  echo "Error: DEPLOYER_KEY not set"
  echo "Export your private key: export DEPLOYER_KEY=0x..."
  exit 1
fi

if [ -z "$BASESCAN_API_KEY" ]; then
  echo "Warning: BASESCAN_API_KEY not set, contracts won't be verified"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$PROJECT_ROOT/packages/contracts"
COUNCIL_DIR="$PROJECT_ROOT/apps/council"

RPC_URL="${RPC_URL:-https://sepolia.base.org}"
CHAIN_ID=84532

echo "═══════════════════════════════════════════════════════════════"
echo "  JEJU AI COUNCIL - BASE SEPOLIA DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "RPC: $RPC_URL"
echo "Chain ID: $CHAIN_ID"
echo ""

# Deploy
cd "$CONTRACTS_DIR"

VERIFY_FLAG=""
if [ -n "$BASESCAN_API_KEY" ]; then
  VERIFY_FLAG="--verify"
  export ETHERSCAN_API_KEY="$BASESCAN_API_KEY"
fi

echo "Deploying contracts..."
forge script script/DeployDAO.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  $VERIFY_FLAG \
  2>&1 | tee /tmp/testnet-deploy.log

# Extract addresses
COUNCIL=$(grep "Council:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
CEO=$(grep "CEOAgent:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
TOKEN=$(grep "GovernanceToken:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
IDENTITY=$(grep "IdentityRegistry:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
REPUTATION=$(grep "ReputationRegistry:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
QUALITY=$(grep "QualityOracle:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')
DEPLOYER=$(grep "Deployer:" /tmp/testnet-deploy.log | tail -1 | awk '{print $2}')

if [ -z "$COUNCIL" ]; then
  echo "Error: Deployment failed"
  exit 1
fi

# Generate testnet config
cat > "$COUNCIL_DIR/.env.testnet" << EOF
# Jeju Council - Base Sepolia Testnet
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

RPC_URL=$RPC_URL
CHAIN_ID=$CHAIN_ID

COUNCIL_ADDRESS=$COUNCIL
CEO_AGENT_ADDRESS=$CEO
GOVERNANCE_TOKEN_ADDRESS=$TOKEN
IDENTITY_REGISTRY_ADDRESS=$IDENTITY
REPUTATION_REGISTRY_ADDRESS=$REPUTATION
QUALITY_ORACLE_ADDRESS=$QUALITY

# Set these manually for production
# OPERATOR_KEY=<your-operator-key>
# ASSESSOR_KEY=<your-assessor-key>

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
EOF

# Save deployment info
cat > "$COUNCIL_DIR/deployment-testnet.json" << EOF
{
  "network": "base-sepolia",
  "chainId": $CHAIN_ID,
  "rpcUrl": "$RPC_URL",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$DEPLOYER",
  "contracts": {
    "GovernanceToken": "$TOKEN",
    "IdentityRegistry": "$IDENTITY",
    "ReputationRegistry": "$REPUTATION",
    "Council": "$COUNCIL",
    "CEOAgent": "$CEO",
    "QualityOracle": "$QUALITY"
  }
}
EOF

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Contracts deployed to Base Sepolia:"
echo "  Council:       $COUNCIL"
echo "  CEOAgent:      $CEO"
echo "  QualityOracle: $QUALITY"
echo ""
echo "View on BaseScan:"
echo "  https://sepolia.basescan.org/address/$COUNCIL"
echo ""
echo "Next steps:"
echo "  1. cp apps/council/.env.testnet apps/council/.env"
echo "  2. Set OPERATOR_KEY in .env"
echo "  3. bun run dev (from apps/council)"
echo ""
