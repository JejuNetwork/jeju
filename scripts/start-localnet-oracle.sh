#!/bin/bash
################################################################################
# Start Oracle Bot for Localnet
################################################################################
# This script starts the oracle price updater bot for Jeju localnet.
# The bot will continuously update ETH/USD and elizaOS/USD prices in the oracle.
#
# Prerequisites:
# - Localnet (anvil) running on localhost:8545
# - Oracle contract deployed (via DeployLiquiditySystem)
# - .env.oracle.local configuration file exists
#
# Usage:
#   ./scripts/start-localnet-oracle.sh         # Start with logs
#   ./scripts/start-localnet-oracle.sh --once  # Single update then exit
################################################################################

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Jeju Oracle Bot - Localnet Mode                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env.oracle.local exists
if [ ! -f ".env.oracle.local" ]; then
    echo -e "${RED}❌ Error: .env.oracle.local not found${NC}"
    echo ""
    echo "Please create .env.oracle.local with the following configuration:"
    echo ""
    echo "  JEJU_RPC_URL=http://localhost:8545"
    echo "  ORACLE_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
    echo "  PRICE_UPDATER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
    echo "  UPDATE_INTERVAL_MS=30000"
    echo "  MOCK_ETH_PRICE=350000000000"
    echo "  MOCK_ELIZA_PRICE=5000000"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Found .env.oracle.local${NC}"

# Load environment variables
set -a
source .env.oracle.local
set +a

# Check if localnet is running
echo -e "\n${BLUE}📡 Checking localnet connection...${NC}"
if ! curl -s -X POST http://localhost:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Cannot connect to localnet at http://localhost:8545${NC}"
    echo ""
    echo "Please start localnet first:"
    echo "  anvil --chain-id 420691 --port 8545"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Localnet is running${NC}"

# Verify oracle contract exists
echo -e "\n${BLUE}📋 Checking oracle contract...${NC}"
if [ -z "$ORACLE_ADDRESS" ]; then
    echo -e "${RED}❌ Error: ORACLE_ADDRESS not set in .env.oracle.local${NC}"
    exit 1
fi

ORACLE_CODE=$(cast code "$ORACLE_ADDRESS" --rpc-url http://localhost:8545 2>/dev/null || echo "")
if [ "$ORACLE_CODE" == "0x" ] || [ -z "$ORACLE_CODE" ]; then
    echo -e "${RED}❌ Error: No contract found at $ORACLE_ADDRESS${NC}"
    echo ""
    echo "Please deploy the oracle first:"
    echo "  cd contracts"
    echo "  forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \\"
    echo "    --rpc-url http://localhost:8545 \\"
    echo "    --broadcast --legacy"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Oracle contract verified at $ORACLE_ADDRESS${NC}"

# Get updater address from private key
UPDATER_ADDRESS=$(cast wallet address "$PRICE_UPDATER_PRIVATE_KEY" 2>/dev/null || echo "")
if [ -z "$UPDATER_ADDRESS" ]; then
    echo -e "${RED}❌ Error: Invalid PRICE_UPDATER_PRIVATE_KEY${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Updater address: $UPDATER_ADDRESS${NC}"

# Check if updater needs to be authorized
echo -e "\n${BLUE}🔐 Checking authorization...${NC}"
CURRENT_UPDATER=$(cast call "$ORACLE_ADDRESS" "priceUpdater()(address)" --rpc-url http://localhost:8545 2>/dev/null || echo "0x0000000000000000000000000000000000000000")

if [ "$CURRENT_UPDATER" == "0x0000000000000000000000000000000000000000" ]; then
    echo -e "${YELLOW}⚠️  No price updater authorized yet${NC}"
    echo -e "${YELLOW}   You may need to authorize this address first:${NC}"
    echo -e "${YELLOW}   cast send $ORACLE_ADDRESS \"setPriceUpdater(address)\" $UPDATER_ADDRESS \\${NC}"
    echo -e "${YELLOW}     --rpc-url http://localhost:8545 \\${NC}"
    echo -e "${YELLOW}     --private-key [DEPLOYER_KEY]${NC}"
    echo ""
elif [ "$(echo "$CURRENT_UPDATER" | tr '[:upper:]' '[:lower:]')" == "$(echo "$UPDATER_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then
    echo -e "${GREEN}✅ Updater is authorized${NC}"
else
    echo -e "${YELLOW}⚠️  Different updater authorized: $CURRENT_UPDATER${NC}"
    echo -e "${YELLOW}   Current updater may not be able to update prices${NC}"
    echo ""
fi

# Display configuration
echo -e "\n${BLUE}⚙️  Oracle Configuration:${NC}"
echo -e "   RPC URL:        $JEJU_RPC_URL"
echo -e "   Oracle:         $ORACLE_ADDRESS"
echo -e "   Updater:        $UPDATER_ADDRESS"
echo -e "   Update Interval: $(($UPDATE_INTERVAL_MS / 1000))s"
echo -e "   ETH Price:      \$$(echo "scale=2; $MOCK_ETH_PRICE / 100000000" | bc)"
echo -e "   elizaOS Price:  \$$(echo "scale=6; $MOCK_ELIZA_PRICE / 100000000" | bc)"
echo -e "   Health Check:   http://localhost:${HEALTH_CHECK_PORT:-3001}/health"

# Check for --once flag
if [ "$1" == "--once" ]; then
    echo -e "\n${BLUE}🚀 Running single update...${NC}\n"
    bun run "$PROJECT_ROOT/scripts/oracle-updater-localnet.ts" --once
    exit $?
fi

# Start the bot
echo -e "\n${GREEN}🤖 Starting oracle bot...${NC}"
echo -e "${YELLOW}   Press Ctrl+C to stop${NC}\n"

# Run with bun
exec bun run "$PROJECT_ROOT/scripts/oracle-updater-localnet.ts"
