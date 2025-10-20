#!/bin/bash

#
# Master Test Script for Jeju Monorepo
# Runs complete test suite including chain setup, contracts, apps, and E2E tests
#
# Usage:
#   ./scripts/test-all.sh              # Run all tests
#   ./scripts/test-all.sh --app bazaar # Test specific app
#   ./scripts/test-all.sh --skip-setup # Skip chain/contract setup
#   ./scripts/test-all.sh --headed     # Run E2E tests in headed mode
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/test-results/logs"
CHAIN_PORT=9545
INDEXER_PORT=4350

# Test flags
SKIP_SETUP=false
SPECIFIC_APP=""
HEADED_MODE=false
CLEANUP_ON_EXIT=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    --app)
      SPECIFIC_APP="$2"
      shift 2
      ;;
    --headed)
      HEADED_MODE=true
      shift
      ;;
    --no-cleanup)
      CLEANUP_ON_EXIT=false
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Create log directory
mkdir -p "$LOG_DIR"

# Process tracking
CHAIN_PID=""
INDEXER_PID=""
declare -A APP_PIDS

# Cleanup function
cleanup() {
  echo -e "${YELLOW}Cleaning up processes...${NC}"

  # Kill chain
  if [[ -n "$CHAIN_PID" ]]; then
    echo "Stopping local chain (PID: $CHAIN_PID)"
    kill $CHAIN_PID 2>/dev/null || true
  fi

  # Kill indexer
  if [[ -n "$INDEXER_PID" ]]; then
    echo "Stopping indexer (PID: $INDEXER_PID)"
    kill $INDEXER_PID 2>/dev/null || true
  fi

  # Kill all apps
  for app in "${!APP_PIDS[@]}"; do
    echo "Stopping $app (PID: ${APP_PIDS[$app]})"
    kill ${APP_PIDS[$app]} 2>/dev/null || true
  done

  # Additional cleanup - find any remaining processes
  lsof -ti:$CHAIN_PORT | xargs kill -9 2>/dev/null || true
  lsof -ti:$INDEXER_PORT | xargs kill -9 2>/dev/null || true

  echo -e "${GREEN}Cleanup complete${NC}"
}

# Register cleanup on exit
if [[ "$CLEANUP_ON_EXIT" == "true" ]]; then
  trap cleanup EXIT
fi

# Helper: Wait for service to be ready
wait_for_service() {
  local name=$1
  local url=$2
  local max_attempts=$3
  local attempt=1

  echo -e "${BLUE}Waiting for $name to be ready at $url...${NC}"

  while ! curl -s "$url" > /dev/null; do
    if [[ $attempt -ge $max_attempts ]]; then
      echo -e "${RED}$name failed to start after $max_attempts attempts${NC}"
      return 1
    fi

    echo "  Attempt $attempt/$max_attempts..."
    sleep 2
    ((attempt++))
  done

  echo -e "${GREEN}$name is ready!${NC}"
  return 0
}

# Step 1: Start local chain
start_chain() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Starting Local Blockchain (Anvil)${NC}"
  echo -e "${BLUE}========================================${NC}"

  # Check if chain is already running
  if lsof -Pi :$CHAIN_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Chain already running on port $CHAIN_PORT${NC}"
    return 0
  fi

  cd "$PROJECT_ROOT"

  # Start anvil with deterministic accounts
  echo "Starting anvil on port $CHAIN_PORT..."
  anvil \
    --port $CHAIN_PORT \
    --chain-id 1337 \
    --block-time 1 \
    > "$LOG_DIR/chain.log" 2>&1 &

  CHAIN_PID=$!
  echo "Chain PID: $CHAIN_PID"

  # Wait for chain to be ready
  if ! wait_for_service "Chain" "http://localhost:$CHAIN_PORT" 30; then
    echo -e "${RED}Failed to start chain${NC}"
    exit 1
  fi
}

# Step 2: Deploy contracts
deploy_contracts() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Deploying Smart Contracts${NC}"
  echo -e "${BLUE}========================================${NC}"

  cd "$PROJECT_ROOT/contracts"

  # Build contracts
  echo "Building contracts..."
  forge build

  # Deploy contracts
  echo "Deploying contracts to local chain..."
  forge script script/Deploy.s.sol \
    --rpc-url http://localhost:$CHAIN_PORT \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    --broadcast \
    > "$LOG_DIR/deploy.log" 2>&1

  # Run contract tests
  echo "Running contract tests..."
  forge test --gas-report

  echo -e "${GREEN}Contracts deployed successfully!${NC}"
}

# Step 3: Start indexer
start_indexer() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Starting Indexer${NC}"
  echo -e "${BLUE}========================================${NC}"

  cd "$PROJECT_ROOT/apps/indexer"

  # Check if indexer is already running
  if lsof -Pi :$INDEXER_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Indexer already running on port $INDEXER_PORT${NC}"
    return 0
  fi

  # Setup database
  echo "Setting up indexer database..."
  bun run db:reset > "$LOG_DIR/indexer-setup.log" 2>&1

  # Start indexer
  echo "Starting indexer..."
  bun run dev > "$LOG_DIR/indexer.log" 2>&1 &
  INDEXER_PID=$!
  echo "Indexer PID: $INDEXER_PID"

  # Wait for indexer to be ready
  if ! wait_for_service "Indexer" "http://localhost:$INDEXER_PORT/health" 60; then
    echo -e "${RED}Failed to start indexer${NC}"
    exit 1
  fi
}

# Step 4: Test specific app
test_app() {
  local app=$1
  local app_dir="$PROJECT_ROOT/apps/$app"

  if [[ ! -d "$app_dir" ]]; then
    echo -e "${RED}App directory not found: $app_dir${NC}"
    return 1
  fi

  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Testing: $app${NC}"
  echo -e "${BLUE}========================================${NC}"

  cd "$app_dir"

  # Check if app has tests
  if ! grep -q '"test"' package.json; then
    echo -e "${YELLOW}No tests found for $app, skipping...${NC}"
    return 0
  fi

  # Install dependencies if needed
  if [[ ! -d "node_modules" ]]; then
    echo "Installing dependencies for $app..."
    bun install
  fi

  # Run tests
  echo "Running tests for $app..."

  # Set environment variables
  export L2_RPC_URL="http://localhost:$CHAIN_PORT"
  export INDEXER_URL="http://localhost:$INDEXER_PORT"
  export CHAIN_ID=1337

  # Run test command
  if [[ "$HEADED_MODE" == "true" ]]; then
    bun run test 2>&1 | tee "$LOG_DIR/$app-test.log"
  else
    bun run test > "$LOG_DIR/$app-test.log" 2>&1
  fi

  local exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}✓ $app tests passed${NC}"
  else
    echo -e "${RED}✗ $app tests failed (exit code: $exit_code)${NC}"
    echo -e "${YELLOW}Check logs: $LOG_DIR/$app-test.log${NC}"
    return $exit_code
  fi

  return 0
}

# Main execution
main() {
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}Jeju Test Suite${NC}"
  echo -e "${GREEN}========================================${NC}"

  # Step 1: Setup infrastructure (unless skipped)
  if [[ "$SKIP_SETUP" == "false" ]]; then
    start_chain
    deploy_contracts
    start_indexer
  else
    echo -e "${YELLOW}Skipping infrastructure setup${NC}"
  fi

  # Step 2: Test apps
  local apps_to_test
  if [[ -n "$SPECIFIC_APP" ]]; then
    apps_to_test=("$SPECIFIC_APP")
  else
    # Test all apps
    apps_to_test=("bazaar" "crucible" "ehorse" "gateway" "leaderboard" "predimarket" "indexer")
  fi

  local failed_apps=()

  for app in "${apps_to_test[@]}"; do
    if ! test_app "$app"; then
      failed_apps+=("$app")
    fi
  done

  # Summary
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}Test Summary${NC}"
  echo -e "${BLUE}========================================${NC}"

  if [[ ${#failed_apps[@]} -eq 0 ]]; then
    echo -e "${GREEN}All tests passed! 🎉${NC}"
    echo -e "${GREEN}Screenshot results: $PROJECT_ROOT/test-results/screenshots/${NC}"
    exit 0
  else
    echo -e "${RED}Tests failed for: ${failed_apps[*]}${NC}"
    echo -e "${YELLOW}Check logs in: $LOG_DIR${NC}"
    exit 1
  fi
}

# Run main
main
