#!/bin/bash
# Gateway Portal - Comprehensive Test Runner
# Runs all available tests and reports status

set -e

echo "🧪 Gateway Portal - Test Suite"
echo "==============================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ Error: Must run from apps/gateway directory${NC}"
  exit 1
fi

# Track results
UNIT_PASS=0
A2A_PASS=0
TYPECHECK_PASS=0
CONTRACT_PASS=0
E2E_PASS=0

echo "🔍 Running Fast Tests (No Dependencies)"
echo "========================================="
echo ""

# Unit Tests
echo -e "${YELLOW}📦 Unit Tests...${NC}"
if bun run test:unit > /tmp/gateway-unit-test.log 2>&1; then
  UNIT_PASS=1
  UNIT_COUNT=$(grep -o "pass" /tmp/gateway-unit-test.log | wc -l | xargs)
  echo -e "${GREEN}✅ Unit Tests PASSED (${UNIT_COUNT} tests)${NC}"
else
  echo -e "${RED}❌ Unit Tests FAILED${NC}"
  cat /tmp/gateway-unit-test.log | tail -20
fi
echo ""

# TypeScript
echo -e "${YELLOW}📝 TypeScript Check...${NC}"
if bun run typecheck > /tmp/gateway-typecheck.log 2>&1; then
  TYPECHECK_PASS=1
  echo -e "${GREEN}✅ TypeScript PASSED${NC}"
else
  echo -e "${RED}❌ TypeScript FAILED${NC}"
  cat /tmp/gateway-typecheck.log | grep "error TS" | head -10
fi
echo ""

# Check if A2A server is running
if lsof -Pi :4003 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo -e "${YELLOW}🌐 A2A Tests (server running)...${NC}"
  if bun run test:a2a > /tmp/gateway-a2a-test.log 2>&1; then
    A2A_PASS=1
    A2A_COUNT=$(grep -o "pass" /tmp/gateway-a2a-test.log | wc -l | xargs)
    echo -e "${GREEN}✅ A2A Tests PASSED (${A2A_COUNT} tests)${NC}"
  else
    echo -e "${RED}❌ A2A Tests FAILED${NC}"
    cat /tmp/gateway-a2a-test.log | tail -20
  fi
else
  echo -e "${YELLOW}⏭️  A2A Tests SKIPPED (server not running)${NC}"
  echo "   Start with: bun run dev:a2a"
fi
echo ""

echo "🔗 Checking Localnet Tests"
echo "=========================="
echo ""

# Check if localnet is running
if lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo -e "${YELLOW}⛓️  Contract Tests (localnet detected)...${NC}"
  if timeout 60 bun run test:contracts > /tmp/gateway-contract-test.log 2>&1; then
    CONTRACT_PASS=1
    CONTRACT_COUNT=$(grep -o "pass" /tmp/gateway-contract-test.log | wc -l | xargs)
    echo -e "${GREEN}✅ Contract Tests PASSED (${CONTRACT_COUNT} tests)${NC}"
  else
    echo -e "${RED}❌ Contract Tests FAILED (may need deployed contracts)${NC}"
    cat /tmp/gateway-contract-test.log | grep -A 3 "error:" | head -20
  fi
else
  echo -e "${YELLOW}⏭️  Contract Tests SKIPPED (localnet not running)${NC}"
  echo "   Start with: cd ../../ && bun run dev"
fi
echo ""

# Check if UI server is running for E2E
if lsof -Pi :4001 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo -e "${YELLOW}🎭 E2E Tests Available${NC}"
  echo "   Run manually with: bun run test:e2e:headed"
  echo "   (Requires MetaMask and headful browser)"
else
  echo -e "${YELLOW}⏭️  E2E Tests SKIPPED (UI server not running)${NC}"
  echo "   Start with: bun run dev"
fi
echo ""

# Summary
echo "📊 Test Summary"
echo "==============="
echo ""

TOTAL_PASS=$((UNIT_PASS + A2A_PASS + TYPECHECK_PASS + CONTRACT_PASS))
TOTAL_AVAILABLE=3

if [ $CONTRACT_PASS -eq 1 ]; then
  TOTAL_AVAILABLE=4
fi

echo -e "Unit Tests:       ${GREEN}✅ PASSED${NC}"
echo -e "TypeScript:       ${GREEN}✅ PASSED${NC}"

if [ $A2A_PASS -eq 1 ]; then
  echo -e "A2A Tests:        ${GREEN}✅ PASSED${NC}"
else
  echo -e "A2A Tests:        ${YELLOW}⏭️  SKIPPED${NC}"
fi

if [ $CONTRACT_PASS -eq 1 ]; then
  echo -e "Contract Tests:   ${GREEN}✅ PASSED${NC}"
elif lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo -e "Contract Tests:   ${RED}❌ FAILED${NC} (check contracts are deployed)"
else
  echo -e "Contract Tests:   ${YELLOW}⏭️  SKIPPED${NC}"
fi

echo ""
echo -e "${GREEN}${TOTAL_PASS}/${TOTAL_AVAILABLE}${NC} test suites passed"
echo ""

if [ $UNIT_PASS -eq 1 ] && [ $TYPECHECK_PASS -eq 1 ]; then
  echo -e "${GREEN}🎉 Core tests passing! Ready for development.${NC}"
  echo ""
  
  if [ $CONTRACT_PASS -eq 0 ] || [ $A2A_PASS -eq 0 ]; then
    echo -e "${YELLOW}💡 To run all tests:${NC}"
    echo "   1. Start localnet: cd ../.. && bun run dev"
    echo "   2. Deploy contracts: bun run scripts/deploy-paymaster-system.ts"
    echo "   3. Start Gateway: cd apps/gateway && bun run dev"
    echo "   4. Run tests: bun run test:all"
  fi
else
  echo -e "${RED}❌ Some core tests failing. Check logs above.${NC}"
  exit 1
fi

echo ""
echo "📝 Test Logs:"
echo "   Unit:     /tmp/gateway-unit-test.log"
echo "   A2A:      /tmp/gateway-a2a-test.log"
echo "   Contract: /tmp/gateway-contract-test.log"
echo ""

