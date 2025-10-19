#!/bin/bash
# Manual deployment using cast send directly
# Workaround for forge create --broadcast bug

set -e

RPC="http://localhost:8545"
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Set env vars for cast
export ETH_RPC_URL="$RPC"
export ETH_FROM="$DEPLOYER"

echo "🐴 eHorse Complete Deployment"
echo ""

CONTRACTS_DIR="/Users/shawwalters/jeju/contracts"

# Deploy elizaOS Token first
echo "1. Deploying elizaOS Token..."
ELIZAOS_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/ElizaOSToken.sol/ElizaOSToken.json)
ENCODED_ARGS=$(cast abi-encode "constructor(address)" $DEPLOYER)
FULL_BYTECODE="${ELIZAOS_BYTECODE}${ENCODED_ARGS:2}"

TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
ELIZAOS=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ elizaOS: $ELIZAOS"

# Mint tokens to deployer
cast send $ELIZAOS "mint(address,uint256)" $DEPLOYER 1000000000000000000000000 --private-key $KEY > /dev/null 2>&1
echo "   ✅ Minted 1M tokens to deployer"
echo ""

# Deploy PredictionOracle
echo "2. Deploying PredictionOracle..."
ORACLE_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/PredictionOracle.sol/PredictionOracle.json)
ENCODED_ARGS=$(cast abi-encode "constructor(address)" $DEPLOYER)
FULL_BYTECODE="${ORACLE_BYTECODE}${ENCODED_ARGS:2}"

TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
ORACLE=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ Oracle: $ORACLE"
echo ""

# Get bytecode for Predimarket
echo "3. Deploying Predimarket..."
PREDIMARKET_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/Predimarket.sol/Predimarket.json)

# Encode constructor args (elizaOS, oracle, owner, treasury)
ENCODED_ARGS=$(cast abi-encode "constructor(address,address,address,address)" $ELIZAOS $ORACLE $DEPLOYER $DEPLOYER)
FULL_BYTECODE="${PREDIMARKET_BYTECODE}${ENCODED_ARGS:2}"
TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
PREDIMARKET=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ Predimarket: $PREDIMARKET"
echo ""

# Deploy MarketFactory
echo "4. Deploying MarketFactory..."
FACTORY_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/MarketFactory.sol/MarketFactory.json)

# Encode constructor args (predimarket, oracle, liquidity, owner)
ENCODED_ARGS=$(cast abi-encode "constructor(address,address,uint256,address)" $PREDIMARKET $ORACLE 1000000000000000000000 $DEPLOYER)
FULL_BYTECODE="${FACTORY_BYTECODE}${ENCODED_ARGS:2}"

TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
FACTORY=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ Factory: $FACTORY"
echo ""

# Configure
echo "5. Transferring ownership..."
cast send $PREDIMARKET "transferOwnership(address)" $FACTORY --private-key $KEY > /dev/null 2>&1
echo "   ✅ Ownership transferred"
echo ""

# Fund agent wallet
echo "6. Funding agent wallet..."
AGENT_WALLET="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
cast send $ELIZAOS "transfer(address,uint256)" $AGENT_WALLET 500000000000000000000000 --private-key $KEY > /dev/null 2>&1
echo "   ✅ Funded agent with 500K elizaOS"
echo ""

# Save to .env
cd /Users/shawwalters/jeju/apps/ehorse
cat > .env << ENVEOF
EHORSE_PORT=5700
EHORSE_SERVER_URL=http://localhost:5700
RPC_URL=$RPC
PRIVATE_KEY=$KEY
PREDICTION_ORACLE_ADDRESS=$ORACLE
MARKET_FACTORY_ADDRESS=$FACTORY
PREDIMARKET_ADDRESS=$PREDIMARKET
ELIZAOS_ADDRESS=$ELIZAOS
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ENVEOF

echo "✅ Saved to .env"
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   ✅ Deployment Complete!                                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Contract Addresses:"
echo "  elizaOS:     $ELIZAOS"
echo "  Oracle:      $ORACLE"
echo "  Predimarket: $PREDIMARKET"
echo "  Factory:     $FACTORY"
echo ""
echo "Agent Wallet: $AGENT_WALLET (funded with 500K elizaOS)"
echo ""
echo "Next Steps:"
echo "  1. Start eHorse: source .env && bun run dev"
echo "  2. Run agent:    source .env && bun run agent"
echo "  3. Run tests:    bun run test"
echo ""

