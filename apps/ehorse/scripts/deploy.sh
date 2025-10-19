#!/bin/bash
# eHorse Contract Deployment
# Simple shell script that just works

set -e

RPC_URL=${RPC_URL:-"http://localhost:8545"}
PRIVATE_KEY=${PRIVATE_KEY:-"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"}
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
ELIZAOS="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🐴 eHorse Contract Deployment                              ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  Deployer: $DEPLOYER"
echo "  elizaOS: $ELIZAOS"
echo ""

cd ../../contracts

echo "1. Deploying PredictionOracle..."
ORACLE=$(forge create src/prediction-markets/PredictionOracle.sol:PredictionOracle \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --constructor-args "$DEPLOYER" \
  2>&1 | grep "Deployed to:" | awk '{print $NF}')

echo "  ✅ $ORACLE"
echo ""

echo "2. Deploying Predimarket..."
PREDIMARKET=$(forge create src/prediction-markets/Predimarket.sol:Predimarket \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --constructor-args "$ELIZAOS" "$ORACLE" "$DEPLOYER" "$DEPLOYER" \
  2>&1 | grep "Deployed to:" | awk '{print $NF}')

echo "  ✅ $PREDIMARKET"
echo ""

echo "3. Deploying MarketFactory..."
FACTORY=$(forge create src/prediction-markets/MarketFactory.sol:MarketFactory \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --constructor-args "$PREDIMARKET" "$ORACLE" "1000000000000000000000" "$DEPLOYER" \
  2>&1 | grep "Deployed to:" | awk '{print $NF}')

echo "  ✅ $FACTORY"
echo ""

echo "4. Configuring Contracts..."
cast send "$PREDIMARKET" \
  "transferOwnership(address)" \
  "$FACTORY" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  > /dev/null 2>&1

echo "  ✅ Transferred Predimarket ownership to MarketFactory"
echo ""

echo "5. Saving Configuration..."

cd ../apps/ehorse

cat > .env << EOF
# eHorse Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

EHORSE_PORT=5700
EHORSE_SERVER_URL=http://localhost:5700

RPC_URL=$RPC_URL
PRIVATE_KEY=$PRIVATE_KEY

PREDICTION_ORACLE_ADDRESS=$ORACLE
MARKET_FACTORY_ADDRESS=$FACTORY
PREDIMARKET_ADDRESS=$PREDIMARKET
ELIZAOS_ADDRESS=$ELIZAOS

# Agent wallet (Anvil default #2)
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
EOF

echo "  ✅ Saved to .env"
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   ✅ Deployment Complete!                                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "Contract Addresses:"
echo "  PredictionOracle: $ORACLE"
echo "  Predimarket:      $PREDIMARKET"
echo "  MarketFactory:    $FACTORY"
echo "  elizaOS:          $ELIZAOS"
echo ""
echo "Next Steps:"
echo "  1. Restart eHorse: source .env && bun run dev"
echo "  2. Run agent:      source .env && bun run agent"
echo ""

