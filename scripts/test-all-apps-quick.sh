#!/bin/bash

#
# Quick test runner for all apps (unit tests only, no E2E)
# Use this to quickly verify code quality without needing infrastructure
#

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Quick Test Suite - Unit Tests Only${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Track results
declare -A RESULTS
TOTAL=0
PASSED=0
FAILED=0

test_app() {
  local app=$1
  local app_dir="$PROJECT_ROOT/apps/$app"

  if [[ ! -d "$app_dir" ]]; then
    echo -e "${YELLOW}⚠️  $app: Directory not found${NC}"
    return
  fi

  cd "$app_dir"

  TOTAL=$((TOTAL + 1))

  echo -e "${GREEN}Testing $app...${NC}"

  # Check if unit tests exist
  if grep -q '"test:unit"' package.json 2>/dev/null; then
    if timeout 60 bun run test:unit > /dev/null 2>&1; then
      echo -e "${GREEN}✅ $app: Unit tests passed${NC}"
      RESULTS[$app]="PASS"
      PASSED=$((PASSED + 1))
    else
      echo -e "${RED}❌ $app: Unit tests failed${NC}"
      RESULTS[$app]="FAIL"
      FAILED=$((FAILED + 1))
    fi
  elif grep -q '"test"' package.json 2>/dev/null; then
    # Try running regular test command (might include E2E)
    echo -e "${YELLOW}⚠️  $app: No test:unit command, skipping${NC}"
    RESULTS[$app]="SKIP"
  else
    echo -e "${YELLOW}⚠️  $app: No test commands found${NC}"
    RESULTS[$app]="SKIP"
  fi

  echo ""
}

# Test all apps
test_app "bazaar"
test_app "ehorse"
test_app "gateway"
test_app "leaderboard"
test_app "predimarket"
test_app "crucible"
test_app "documentation"
test_app "indexer"

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

for app in "${!RESULTS[@]}"; do
  result="${RESULTS[$app]}"
  case $result in
    PASS)
      echo -e "${GREEN}✅ $app${NC}"
      ;;
    FAIL)
      echo -e "${RED}❌ $app${NC}"
      ;;
    SKIP)
      echo -e "${YELLOW}⚠️  $app (skipped)${NC}"
      ;;
  esac
done

echo ""
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total: $TOTAL"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
