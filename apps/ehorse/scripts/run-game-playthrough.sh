#!/bin/bash
# Run full eHorse game playthrough with Dappwright
# This script:
# 1. Starts anvil (if not running)
# 2. Deploys contracts
# 3. Starts eHorse server
# 4. Runs the full game playthrough test
# 5. Cleans up

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                            ║${NC}"
echo -e "${BLUE}║   🐴 eHorse Full Game Playthrough Test    ║${NC}"
echo -e "${BLUE}║                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Cleanup function
cleanup() {
  echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
  
  if [ ! -z "$ANVIL_PID" ]; then
    echo "Stopping anvil (PID: $ANVIL_PID)..."
    kill $ANVIL_PID 2>/dev/null || true
  fi
  
  if [ ! -z "$SERVER_PID" ]; then
    echo "Stopping eHorse server (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
  fi
  
  echo -e "${GREEN}✅ Cleanup complete${NC}"
}

trap cleanup EXIT INT TERM

# Check if anvil is already running
if lsof -Pi :8545 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
  echo -e "${YELLOW}⚠️  Anvil already running on port 8545${NC}"
  ANVIL_PID=""
else
  echo -e "${BLUE}1️⃣  Starting Anvil...${NC}"
  anvil --port 8545 > /dev/null 2>&1 &
  ANVIL_PID=$!
  echo -e "${GREEN}✅ Anvil started (PID: $ANVIL_PID)${NC}"
  sleep 2
fi

# Deploy contracts
echo -e "\n${BLUE}2️⃣  Deploying contracts...${NC}"
cd "$(dirname "$0")/.."

if [ -f ".env" ]; then
  source .env
fi

# Run deployment script
bash scripts/manual-deploy.sh || {
  echo -e "${RED}❌ Contract deployment failed${NC}"
  exit 1
}

echo -e "${GREEN}✅ Contracts deployed${NC}"

# Check if server is running
if lsof -Pi :5700 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
  echo -e "${YELLOW}⚠️  eHorse server already running on port 5700${NC}"
  SERVER_PID=""
else
  # Start eHorse server
  echo -e "\n${BLUE}3️⃣  Starting eHorse server...${NC}"
  source .env 2>/dev/null || true
  bun run src/index.ts > ehorse.log 2>&1 &
  SERVER_PID=$!
  echo -e "${GREEN}✅ eHorse server started (PID: $SERVER_PID)${NC}"
  
  # Wait for server to be ready
  echo "Waiting for server to be ready..."
  for i in {1..30}; do
    if curl -s http://localhost:5700/health > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Server is ready${NC}"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}❌ Server failed to start${NC}"
      cat ehorse.log
      exit 1
    fi
    sleep 1
  done
fi

# Run the playthrough test
echo -e "\n${BLUE}4️⃣  Running game playthrough test...${NC}"
echo ""

# Set environment variables
export EHORSE_URL="http://localhost:5700"
export RPC_URL="http://localhost:8545"

# Run Playwright test
npx playwright test tests/e2e/08-full-game-playthrough.spec.ts --reporter=list

TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                                            ║${NC}"
  echo -e "${GREEN}║   ✅ GAME PLAYTHROUGH TEST PASSED! 🎉     ║${NC}"
  echo -e "${GREEN}║                                            ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
else
  echo -e "\n${RED}╔════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                                            ║${NC}"
  echo -e "${RED}║   ❌ GAME PLAYTHROUGH TEST FAILED          ║${NC}"
  echo -e "${RED}║                                            ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════╝${NC}"
  
  echo -e "\n${YELLOW}📋 Check logs:${NC}"
  echo "  - Server log: ehorse.log"
  echo "  - Test report: playwright-report/"
  echo "  - Screenshots: playwright-report/*.png"
fi

exit $TEST_EXIT_CODE

