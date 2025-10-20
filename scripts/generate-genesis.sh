#!/bin/bash
#
# Generate Genesis and Rollup Configs
# 
# Prerequisites:
#  - op-node installed
#  - L1 contracts deployed
#  - deploy-config.json filled out
#
# Usage:
#   ./generate-genesis.sh testnet
#   ./generate-genesis.sh mainnet
#

set -e

NETWORK="${1:-testnet}"

echo "🔧 Generating Genesis and Rollup Config for $NETWORK"
echo "=".repeat(60)

# Paths
DEPLOY_CONFIG="config/deploy-configs/${NETWORK}.json"
L1_DEPLOYMENTS="deployments/base-${NETWORK}/l1-contracts.json"
OUTPUT_DIR="config/generated/${NETWORK}"

# Validate inputs
if [ ! -f "$DEPLOY_CONFIG" ]; then
    echo "❌ Deploy config not found: $DEPLOY_CONFIG"
    exit 1
fi

if [ ! -f "$L1_DEPLOYMENTS" ]; then
    echo "❌ L1 deployments not found: $L1_DEPLOYMENTS"
    echo "Deploy L1 contracts first: forge script script/Deploy.s.sol --broadcast"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Generate configs
echo "📝 Generating genesis.json and rollup.json..."

op-node genesis l2 \
    --deploy-config "$DEPLOY_CONFIG" \
    --l1-deployments "$L1_DEPLOYMENTS" \
    --outfile.l2 "$OUTPUT_DIR/genesis.json" \
    --outfile.rollup "$OUTPUT_DIR/rollup.json"

if [ $? -eq 0 ]; then
    echo "✅ Genesis and rollup configs generated!"
    echo ""
    echo "Files created:"
    echo "  $OUTPUT_DIR/genesis.json"
    echo "  $OUTPUT_DIR/rollup.json"
    echo ""
    echo "Next steps:"
    echo "  1. Review configs:"
    echo "     cat $OUTPUT_DIR/genesis.json | jq ."
    echo "  2. Copy to main config directory:"
    echo "     cp $OUTPUT_DIR/rollup.json config/rollup/${NETWORK}.json"
    echo "  3. Distribute to node operators"
    echo "  4. Start your sequencer/batcher/proposer"
else
    echo "❌ Config generation failed"
    exit 1
fi

