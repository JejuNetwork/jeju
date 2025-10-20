#!/bin/bash
# Manual deployment using cast send directly
# Workaround for forge create --broadcast bug

set -e

RPC="${RPC_URL:-http://localhost:8545}"
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Set env vars for cast
export ETH_RPC_URL="$RPC"
export ETH_FROM="$DEPLOYER"

echo "🐴 eHorse Complete Deployment (On-Chain Version)"
echo ""

CONTRACTS_DIR="/Users/shawwalters/jeju/contracts"

# Compile all contracts first
echo "🔨 Compiling contracts..."
cd $CONTRACTS_DIR
forge build src/tokens/ElizaOSToken.sol \
           src/games/Contest.sol \
           src/prediction-markets/Predimarket.sol \
           src/prediction-markets/MarketFactory.sol \
           src/registry/IdentityRegistry.sol \
           --force > /dev/null 2>&1
echo "✅ Compilation complete"
echo ""

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

# Deploy Contest.sol (TEE oracle)
echo "2. Deploying Contest.sol (TEE oracle)..."
CONTEST_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/Contest.sol/Contest.json)
ENCODED_ARGS=$(cast abi-encode "constructor(address)" $DEPLOYER)
FULL_BYTECODE="${CONTEST_BYTECODE}${ENCODED_ARGS:2}"

TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
CONTEST=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ Contest: $CONTEST"
echo ""

# Get bytecode for Predimarket
echo "3. Deploying Predimarket..."
PREDIMARKET_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/Predimarket.sol/Predimarket.json)

# Encode constructor args (elizaOS, contest/oracle, owner, treasury)
ENCODED_ARGS=$(cast abi-encode "constructor(address,address,address,address)" $ELIZAOS $CONTEST $DEPLOYER $DEPLOYER)
FULL_BYTECODE="${PREDIMARKET_BYTECODE}${ENCODED_ARGS:2}"
TX_HASH=$(cast send --private-key $KEY --json --create "$FULL_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
PREDIMARKET=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ Predimarket: $PREDIMARKET"
echo ""

# Deploy MarketFactory
echo "4. Deploying MarketFactory..."
FACTORY_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/MarketFactory.sol/MarketFactory.json)

# Encode constructor args (predimarket, contest, liquidity, owner)
ENCODED_ARGS=$(cast abi-encode "constructor(address,address,uint256,address)" $PREDIMARKET $CONTEST 1000000000000000000000 $DEPLOYER)
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

# Deploy IdentityRegistry (ERC-8004)
echo "6. Deploying IdentityRegistry (ERC-8004)..."
REGISTRY_BYTECODE=$(jq -r '.bytecode.object' $CONTRACTS_DIR/out/IdentityRegistry.sol/IdentityRegistry.json)

TX_HASH=$(cast send --private-key $KEY --json --create "$REGISTRY_BYTECODE" | jq -r '.transactionHash')
RECEIPT=$(cast receipt $TX_HASH --json)
IDENTITY_REGISTRY=$(echo $RECEIPT | jq -r '.contractAddress')
echo "   ✅ IdentityRegistry: $IDENTITY_REGISTRY"
echo ""

# Approve TEE container hash
echo "7. Approving TEE container hash..."
CONTAINER_HASH=$(echo -n "ehorse-tee:v1.0.0" | sha256sum | awk '{print "0x" $1}')
cast send $CONTEST "approveContainerHash(bytes32,bool)" $CONTAINER_HASH true --private-key $KEY > /dev/null 2>&1
echo "   ✅ Container hash approved: ${CONTAINER_HASH:0:20}..."
echo ""

# Fund agent wallet
echo "8. Funding agent wallet..."
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

# TEE Contest Oracle
CONTEST_ADDRESS=$CONTEST

# Prediction Market Contracts  
MARKET_FACTORY_ADDRESS=$FACTORY
PREDIMARKET_ADDRESS=$PREDIMARKET
ELIZAOS_ADDRESS=$ELIZAOS

# ERC-8004 Registry
IDENTITY_REGISTRY_ADDRESS=$IDENTITY_REGISTRY

# Agent
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
echo "  elizaOS:          $ELIZAOS"
echo "  🔒 Contest.sol:   $CONTEST (TEE oracle)"
echo "  Predimarket:      $PREDIMARKET"
echo "  MarketFactory:    $FACTORY"
echo "  📝 IdentityRegistry: $IDENTITY_REGISTRY (ERC-8004)"
echo ""
echo "Agent Wallet: $AGENT_WALLET (funded with 500K elizaOS)"
echo ""
echo "Architecture:"
echo "  📱 Game runs OFF-CHAIN in TEE (game.ts)"
echo "  📜 Results published ON-CHAIN with attestation (Contest.sol)"
echo "  🏭 Markets auto-created on Predimarket (MarketFactory)"
echo "  🎮 Playable via UI and A2A protocol"
echo ""
echo "Next Steps:"
echo "  1. Start eHorse TEE:  source .env && bun run dev"
echo "  2. Run agent:         source .env && bun run agent"
echo "  3. Run tests:         bun run test"
echo "  4. Run contract tests: cd ../../contracts && forge test --match-contract ContestTest"
echo ""

