#!/bin/bash
# Complete eHorse Test Runner
# Deploys contracts, starts services, runs tests

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🧪 eHorse Complete Test Suite                             ║"
echo "║   Full integration testing with all tokens                   ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v bun &> /dev/null; then
  echo "❌ Bun not found. Install from https://bun.sh"
  exit 1
fi

if ! command -v cast &> /dev/null; then
  echo "❌ Foundry not found. Install from https://book.getfoundry.sh"
  exit 1
fi

if ! pgrep -x "anvil" > /dev/null; then
  echo "❌ Anvil not running!"
  echo "   Start it in another terminal: anvil"
  exit 1
fi

echo "✅ All prerequisites met"
echo ""

# Step 1: Setup test environment
echo "1️⃣  Setting up test environment..."
bun run scripts/setup-test-env.ts

if [ ! -f ".env.test" ]; then
  echo "❌ Test environment setup failed"
  exit 1
fi

echo "✅ Test environment ready"
echo ""

# Step 2: Load environment
echo "2️⃣  Loading environment..."
source .env.test
echo "✅ Environment loaded"
echo ""

# Step 3: Start eHorse server
echo "3️⃣  Starting eHorse server..."
bun run dev > /tmp/ehorse-test.log 2>&1 &
EHORSE_PID=$!

# Wait for server to start
sleep 3

if ! curl -s http://localhost:5700/health > /dev/null; then
  echo "❌ eHorse server failed to start"
  echo "   Check logs: tail /tmp/ehorse-test.log"
  kill $EHORSE_PID 2>/dev/null || true
  exit 1
fi

echo "✅ eHorse server running (PID: $EHORSE_PID)"
echo ""

# Step 4: Run tests
echo "4️⃣  Running E2E tests..."
echo ""

if npx playwright test; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                                                              ║"
  echo "║   ✅ ALL TESTS PASSED!                                       ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  
  echo "📊 Test Report:"
  echo "   View at: npx playwright show-report"
  echo ""
  
  TEST_SUCCESS=true
else
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                                                              ║"
  echo "║   ❌ TESTS FAILED                                            ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  
  echo "📋 Debugging:"
  echo "   Server logs: tail /tmp/ehorse-test.log"
  echo "   Test report: npx playwright show-report"
  echo ""
  
  TEST_SUCCESS=false
fi

# Step 5: Cleanup
echo "5️⃣  Cleaning up..."
kill $EHORSE_PID 2>/dev/null || true
echo "✅ eHorse server stopped"
echo ""

# Exit with appropriate code
if [ "$TEST_SUCCESS" = true ]; then
  echo "🎉 Complete test cycle verified!"
  echo ""
  echo "What was tested:"
  echo "  ✅ Race creation & lifecycle"
  echo "  ✅ Oracle commitment & reveal"
  echo "  ✅ Market auto-creation"
  echo "  ✅ Multi-token betting (4 tokens)"
  echo "  ✅ Market resolution"
  echo "  ✅ Payout claims"
  echo "  ✅ On-chain state verification"
  echo ""
  echo "eHorse is production-ready! 🚀🐴"
  exit 0
else
  echo "Fix issues and run again: bash scripts/run-complete-test.sh"
  exit 1
fi

