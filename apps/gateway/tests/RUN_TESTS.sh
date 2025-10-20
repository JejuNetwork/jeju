#!/bin/bash
# Gateway Portal - Test Runner Script
# Runs all tests in the correct order with proper setup validation

set -e

echo "🧪 Gateway Portal - Test Suite Runner"
echo "====================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ Error: Must run from apps/gateway directory${NC}"
  exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}📦 Installing dependencies...${NC}"
  bun install
fi

# Check if Playwright browsers are installed
if [ ! -d "playwright/.cache" ]; then
  echo -e "${YELLOW}🌐 Installing Playwright browsers...${NC}"
  bunx playwright install chromium
fi

# Check if servers are running (for E2E tests)
check_server() {
  local port=$1
  local name=$2
  
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✅ $name is running on port $port${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  $name not running on port $port${NC}"
    return 1
  fi
}

echo ""
echo "Checking test environment..."
echo "----------------------------"

RPC_RUNNING=false
UI_RUNNING=false
A2A_RUNNING=false

if check_server 9545 "Localnet RPC"; then RPC_RUNNING=true; fi
if check_server 4001 "Gateway UI"; then UI_RUNNING=true; fi
if check_server 4003 "A2A Server"; then A2A_RUNNING=true; fi

echo ""

# Run tests based on what's available
echo "Running tests..."
echo "================"
echo ""

# Always run unit tests
echo -e "${GREEN}1️⃣  Running Unit Tests${NC}"
echo "   Fast, no dependencies needed"
echo ""
NODE_ENV=test bun run test:unit
echo ""

# Run contract tests if RPC is available
if [ "$RPC_RUNNING" = true ]; then
  echo -e "${GREEN}2️⃣  Running Contract Tests${NC}"
  echo "   Direct blockchain interaction"
  echo ""
  bun run test:contracts
  echo ""
else
  echo -e "${YELLOW}⏭️  Skipping contract tests (localnet not running)${NC}"
  echo "   Start with: bun run dev"
  echo ""
fi

# Run A2A tests if server is available
if [ "$A2A_RUNNING" = true ]; then
  echo -e "${GREEN}3️⃣  Running A2A Tests${NC}"
  echo "   Agent protocol communication"
  echo ""
  bun run test:a2a
  echo ""
else
  echo -e "${YELLOW}⏭️  Skipping A2A tests (A2A server not running)${NC}"
  echo "   Start with: bun run dev:a2a"
  echo ""
fi

# Run E2E tests if all servers are available
if [ "$RPC_RUNNING" = true ] && [ "$UI_RUNNING" = true ]; then
  echo -e "${GREEN}4️⃣  Running E2E Tests${NC}"
  echo "   Full user flow automation with MetaMask"
  echo "   This will take ~5 minutes..."
  echo ""
  
  read -p "Run E2E tests? (y/n) " -n 1 -r
  echo ""
  
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    bun run test:e2e
    echo ""
    echo -e "${GREEN}📊 View test report: bun run test:report${NC}"
  else
    echo -e "${YELLOW}⏭️  Skipping E2E tests${NC}"
  fi
else
  echo -e "${YELLOW}⏭️  Skipping E2E tests (servers not running)${NC}"
  echo "   Start with: bun run dev"
fi

echo ""
echo "🎉 Test run complete!"
echo ""

# Summary
echo "Summary:"
echo "--------"
echo -e "Unit Tests:     ${GREEN}✅ PASSED${NC}"
[ "$RPC_RUNNING" = true ] && echo -e "Contract Tests: ${GREEN}✅ PASSED${NC}" || echo -e "Contract Tests: ${YELLOW}⏭️  SKIPPED${NC}"
[ "$A2A_RUNNING" = true ] && echo -e "A2A Tests:      ${GREEN}✅ PASSED${NC}" || echo -e "A2A Tests:      ${YELLOW}⏭️  SKIPPED${NC}"
echo ""

if [ "$RPC_RUNNING" = false ] || [ "$UI_RUNNING" = false ] || [ "$A2A_RUNNING" = false ]; then
  echo -e "${YELLOW}💡 To run all tests, start the full dev environment:${NC}"
  echo "   cd /path/to/jeju"
  echo "   bun run dev"
  echo ""
fi


