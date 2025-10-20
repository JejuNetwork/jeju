#!/bin/bash

#
# Test Individual App Script
# Tests a single Jeju app with all its dependencies
#
# Usage:
#   ./scripts/test-app.sh bazaar          # Test bazaar
#   ./scripts/test-app.sh bazaar --headed # Test in headed mode
#   ./scripts/test-app.sh bazaar --unit   # Run only unit tests
#   ./scripts/test-app.sh bazaar --e2e    # Run only E2E tests
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${1:-}"
TEST_TYPE="all"  # all, unit, e2e
HEADED_MODE=false

# Parse arguments
shift || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --unit)
      TEST_TYPE="unit"
      shift
      ;;
    --e2e)
      TEST_TYPE="e2e"
      shift
      ;;
    --headed)
      HEADED_MODE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate app name
if [[ -z "$APP_NAME" ]]; then
  echo -e "${RED}Error: App name required${NC}"
  echo "Usage: ./scripts/test-app.sh <app-name> [options]"
  echo ""
  echo "Available apps:"
  echo "  - bazaar"
  echo "  - crucible"
  echo "  - ehorse"
  echo "  - gateway"
  echo "  - leaderboard"
  echo "  - predimarket"
  echo "  - indexer"
  echo "  - documentation"
  exit 1
fi

APP_DIR="$PROJECT_ROOT/apps/$APP_NAME"
if [[ ! -d "$APP_DIR" ]]; then
  echo -e "${RED}Error: App directory not found: $APP_DIR${NC}"
  exit 1
fi

# App configuration
declare -A APP_PORTS=(
  ["bazaar"]="4006"
  ["crucible"]="7777"
  ["ehorse"]="5700"
  ["gateway"]="4001"
  ["leaderboard"]="3000"
  ["predimarket"]="4005"
  ["indexer"]="4350"
  ["documentation"]="4004"
)

declare -A APP_NEEDS_CHAIN=(
  ["bazaar"]="true"
  ["crucible"]="false"
  ["ehorse"]="true"
  ["gateway"]="true"
  ["leaderboard"]="false"
  ["predimarket"]="true"
  ["indexer"]="true"
  ["documentation"]="false"
)

declare -A APP_NEEDS_INDEXER=(
  ["bazaar"]="true"
  ["crucible"]="false"
  ["ehorse"]="true"
  ["gateway"]="true"
  ["leaderboard"]="true"
  ["predimarket"]="true"
  ["indexer"]="false"
  ["documentation"]="false"
)

APP_PORT="${APP_PORTS[$APP_NAME]}"
NEEDS_CHAIN="${APP_NEEDS_CHAIN[$APP_NAME]}"
NEEDS_INDEXER="${APP_NEEDS_INDEXER[$APP_NAME]}"

# Check dependencies
check_dependencies() {
  echo -e "${BLUE}Checking dependencies for $APP_NAME...${NC}"

  # Check if chain is needed and running
  if [[ "$NEEDS_CHAIN" == "true" ]]; then
    if ! lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null; then
      echo -e "${YELLOW}Warning: Local chain not running on port 9545${NC}"
      echo -e "${YELLOW}Start it with: anvil --port 9545 --chain-id 1337${NC}"

      if [[ "$TEST_TYPE" == "e2e" ]]; then
        echo -e "${RED}Chain is required for E2E tests${NC}"
        exit 1
      fi
    else
      echo -e "${GREEN}✓ Chain is running${NC}"
    fi
  fi

  # Check if indexer is needed and running
  if [[ "$NEEDS_INDEXER" == "true" ]]; then
    if ! lsof -Pi :4350 -sTCP:LISTEN -t >/dev/null; then
      echo -e "${YELLOW}Warning: Indexer not running on port 4350${NC}"
      echo -e "${YELLOW}Start it with: cd apps/indexer && bun run dev${NC}"

      if [[ "$TEST_TYPE" == "e2e" ]]; then
        echo -e "${RED}Indexer is required for E2E tests${NC}"
        exit 1
      fi
    else
      echo -e "${GREEN}✓ Indexer is running${NC}"
    fi
  fi
}

# Install dependencies
install_dependencies() {
  cd "$APP_DIR"

  if [[ ! -d "node_modules" ]]; then
    echo -e "${BLUE}Installing dependencies for $APP_NAME...${NC}"
    bun install
  else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
  fi
}

# Run tests
run_tests() {
  cd "$APP_DIR"

  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Running Tests for $APP_NAME${NC}"
  echo -e "${BLUE}========================================${NC}"

  # Set environment variables
  export L2_RPC_URL="http://localhost:9545"
  export INDEXER_URL="http://localhost:4350"
  export CHAIN_ID=1337
  export ${APP_NAME^^}_PORT="$APP_PORT"

  # Determine which tests to run
  case "$TEST_TYPE" in
    unit)
      echo "Running unit tests..."
      if grep -q '"test:unit"' package.json; then
        bun run test:unit
      else
        echo -e "${YELLOW}No unit tests configured${NC}"
      fi
      ;;
    e2e)
      echo "Running E2E tests..."
      if grep -q '"test:e2e"' package.json; then
        if [[ "$HEADED_MODE" == "true" ]]; then
          bun run test:e2e:headed || bun run test:e2e --headed
        else
          bun run test:e2e
        fi
      else
        echo -e "${YELLOW}No E2E tests configured${NC}"
      fi
      ;;
    all)
      echo "Running all tests..."
      if grep -q '"test"' package.json; then
        if [[ "$HEADED_MODE" == "true" ]]; then
          HEADLESS=false bun run test
        else
          bun run test
        fi
      else
        echo -e "${YELLOW}No tests configured${NC}"
        return 1
      fi
      ;;
  esac

  local exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Tests passed for $APP_NAME${NC}"
    echo -e "${GREEN}========================================${NC}"

    # Show screenshots if they exist
    local screenshot_dir="$APP_DIR/test-results/screenshots/$APP_NAME"
    if [[ -d "$screenshot_dir" ]]; then
      echo -e "${BLUE}Screenshots saved to:${NC}"
      echo "  $screenshot_dir"
      echo ""
      echo "Screenshot summary:"
      find "$screenshot_dir" -name "*.png" | head -10 | while read -r file; do
        echo "  - $(basename $file)"
      done
      local total=$(find "$screenshot_dir" -name "*.png" | wc -l | tr -d ' ')
      if [[ $total -gt 10 ]]; then
        echo "  ... and $((total - 10)) more"
      fi
    fi
  else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}✗ Tests failed for $APP_NAME${NC}"
    echo -e "${RED}========================================${NC}"
  fi

  return $exit_code
}

# Main execution
main() {
  echo -e "${GREEN}Testing $APP_NAME${NC}"
  echo ""

  check_dependencies
  install_dependencies
  run_tests

  exit $?
}

main
