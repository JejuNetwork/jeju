#!/bin/bash
# Real E2E Test Environment Setup
# Deploys real contracts to Anvil for integration testing

set -e

echo "🚀 Setting up real e2e test environment..."
echo ""

# Check prerequisites
command -v anvil >/dev/null 2>&1 || { echo "❌ Anvil not found. Install Foundry first."; exit 1; }
command -v forge >/dev/null 2>&1 || { echo "❌ Forge not found. Install Foundry first."; exit 1; }
command -v cast >/dev/null 2>&1 || { echo "❌ Cast not found. Install Foundry first."; exit 1; }

echo "✅ Prerequisites installed"
echo ""

# Start Anvil in background if not running
if ! lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null ; then
    echo "Starting Anvil on port 9545..."
    anvil --port 9545 --chain-id 1337 --block-time 2 --accounts 10 --balance 10000 > /tmp/anvil-predimarket.log 2>&1 &
    ANVIL_PID=$!
    echo "✅ Anvil started (PID: $ANVIL_PID)"
    echo "   Logs: /tmp/anvil-predimarket.log"
    sleep 3
else
    echo "✅ Anvil already running on port 9545"
fi

echo ""

# Deploy contracts using comprehensive Forge script
echo "📝 Deploying Predimarket system..."
cd ../../contracts

# Default Anvil account
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
RPC_URL="http://localhost:9545"

# Run the full deployment script (skip verification for local)
export BASESCAN_API_KEY="dummy"
export ETHERSCAN_API_KEY="dummy"
forge script script/DeployPredimarketFull.s.sol:DeployPredimarketFull \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --skip-simulation \
  -vvv

# Extract addresses from the deployment JSON
DEPLOYMENT_FILE="deployments/predimarket-1337.json"

if [ ! -f "$DEPLOYMENT_FILE" ]; then
    echo "❌ Deployment file not found: $DEPLOYMENT_FILE"
    exit 1
fi

# Parse JSON (requires jq or manual parsing)
if command -v jq >/dev/null 2>&1; then
    ELIZAOS_ADDRESS=$(jq -r '.elizaOSToken' $DEPLOYMENT_FILE)
    ORACLE_ADDRESS=$(jq -r '.predictionOracle' $DEPLOYMENT_FILE)
    PREDIMARKET_ADDRESS=$(jq -r '.predimarket' $DEPLOYMENT_FILE)
    FACTORY_ADDRESS=$(jq -r '.marketFactory' $DEPLOYMENT_FILE)
else
    # Manual parsing if jq not available
    ELIZAOS_ADDRESS=$(grep -o '"elizaOSToken": "[^"]*"' $DEPLOYMENT_FILE | cut -d'"' -f4)
    ORACLE_ADDRESS=$(grep -o '"predictionOracle": "[^"]*"' $DEPLOYMENT_FILE | cut -d'"' -f4)
    PREDIMARKET_ADDRESS=$(grep -o '"predimarket": "[^"]*"' $DEPLOYMENT_FILE | cut -d'"' -f4)
    FACTORY_ADDRESS=$(grep -o '"marketFactory": "[^"]*"' $DEPLOYMENT_FILE | cut -d'"' -f4)
fi

echo ""
echo "✅ All contracts deployed!"
echo "   ElizaOS Token:     $ELIZAOS_ADDRESS"
echo "   PredictionOracle:  $ORACLE_ADDRESS"
echo "   Predimarket:       $PREDIMARKET_ADDRESS"
echo "   MarketFactory:     $FACTORY_ADDRESS"
echo ""

# Update environment file
echo "📝 Updating .env.local..."
cd ../apps/predimarket
cat > .env.local << EOF
# Real E2E Test Environment - Generated $(date)

# Blockchain
NEXT_PUBLIC_RPC_URL=http://localhost:9545
NEXT_PUBLIC_CHAIN_ID=1337

# Deployed Contracts
NEXT_PUBLIC_PREDIMARKET_ADDRESS=$PREDIMARKET_ADDRESS
NEXT_PUBLIC_ELIZA_OS_ADDRESS=$ELIZAOS_ADDRESS
NEXT_PUBLIC_PREDICTION_ORACLE_ADDRESS=$ORACLE_ADDRESS
NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=$FACTORY_ADDRESS

# Indexer
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:4350/graphql

# WalletConnect (optional)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=predimarket

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:4005

# Test Wallet (for development only!)
TEST_WALLET_SEED=test test test test test test test test test test test junk
TEST_WALLET_PASSWORD=TestPassword123!
EOF

echo "✅ Environment configured"
echo ""

# Show deployment summary
echo "================================================"
echo "🎉 Real E2E Test Environment Ready!"
echo "================================================"
echo ""
echo "Deployed Contracts:"
echo "  ElizaOS Token:       $ELIZAOS_ADDRESS"
echo "  PredictionOracle:    $ORACLE_ADDRESS"
echo "  Predimarket:         $PREDIMARKET_ADDRESS"
echo "  MarketFactory:       $FACTORY_ADDRESS"
echo ""
echo "Network:"
echo "  RPC:                 http://localhost:9545"
echo "  Chain ID:            1337"
echo "  Deployer:            $DEPLOYER"
echo ""
echo "Next Steps:"
echo "  1. Start indexer:    cd apps/indexer && bun run dev"
echo "  2. Seed test data:   cd apps/predimarket && bun run seed-data"
echo "  3. Start frontend:   cd apps/predimarket && bun run dev"
echo "  4. Run e2e tests:    cd apps/predimarket && bun run test:e2e:wallet"
echo ""
echo "================================================"

