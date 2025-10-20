#!/bin/bash
# Start Complete Real E2E Test Environment
# Orchestrates: Anvil + Contracts + Indexer + Frontend

set -e

PROJECT_ROOT="/Users/shawwalters/jeju"
PREDIMARKET_DIR="$PROJECT_ROOT/apps/predimarket"

echo "🚀 Starting Complete Real E2E Test Environment"
echo "================================================"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down test environment..."
    kill $(jobs -p) 2>/dev/null || true
    wait 2>/dev/null || true
    echo "✅ Cleanup complete"
}

trap cleanup EXIT INT TERM

# 1. Start Anvil
echo "1️⃣  Starting Anvil (port 9545)..."
if lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null ; then
    echo "   ⚠️  Port 9545 already in use, killing existing process..."
    lsof -ti:9545 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

anvil --port 9545 --chain-id 1337 --block-time 2 --accounts 10 --balance 10000 > /tmp/anvil-test.log 2>&1 &
ANVIL_PID=$!
sleep 3

if ! lsof -Pi :9545 -sTCP:LISTEN -t >/dev/null ; then
    echo "   ❌ Failed to start Anvil"
    cat /tmp/anvil-test.log
    exit 1
fi

echo "   ✅ Anvil running (PID: $ANVIL_PID)"
echo "   📝 Logs: /tmp/anvil-test.log"
echo ""

# 2. Deploy Contracts
echo "2️⃣  Deploying contracts..."
cd "$PREDIMARKET_DIR"
if [ -f "./scripts/test-env-setup.sh" ]; then
    ./scripts/test-env-setup.sh
    echo "   ✅ Contracts deployed"
else
    echo "   ⚠️  Deployment script not fully implemented yet"
    echo "   📝 Contracts need to be deployed manually"
fi
echo ""

# 3. Start Indexer (if available)
echo "3️⃣  Starting Indexer (port 4350)..."
if [ -d "$PROJECT_ROOT/apps/indexer" ]; then
    if lsof -Pi :4350 -sTCP:LISTEN -t >/dev/null ; then
        echo "   ✅ Indexer already running on port 4350"
    else
        cd "$PROJECT_ROOT/apps/indexer"
        bun run dev > /tmp/indexer-test.log 2>&1 &
        INDEXER_PID=$!
        sleep 5
        
        if lsof -Pi :4350 -sTCP:LISTEN -t >/dev/null ; then
            echo "   ✅ Indexer running (PID: $INDEXER_PID)"
            echo "   📝 Logs: /tmp/indexer-test.log"
        else
            echo "   ⚠️  Indexer failed to start, continuing without it"
            echo "   📝 E2E tests may show 'No markets' without indexer"
        fi
    fi
else
    echo "   ⚠️  Indexer not found at $PROJECT_ROOT/apps/indexer"
fi
echo ""

# 4. Seed Test Data (if script exists)
echo "4️⃣  Seeding test data..."
cd "$PREDIMARKET_DIR"
if [ -f "./scripts/seed-testdata.ts" ]; then
    bun run seed-data 2>/dev/null || echo "   ⚠️  Seeding not yet fully implemented"
else
    echo "   ⚠️  Seed script not found"
fi
echo ""

# 5. Start Predimarket Frontend
echo "5️⃣  Starting Predimarket Frontend (port 4005)..."
if lsof -Pi :4005 -sTCP:LISTEN -t >/dev/null ; then
    echo "   ⚠️  Port 4005 already in use, killing existing process..."
    lsof -ti:4005 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

cd "$PREDIMARKET_DIR"
bun run dev > /tmp/predimarket-test.log 2>&1 &
FRONTEND_PID=$!
sleep 5

if ! lsof -Pi :4005 -sTCP:LISTEN -t >/dev/null ; then
    echo "   ❌ Failed to start frontend"
    cat /tmp/predimarket-test.log
    exit 1
fi

echo "   ✅ Frontend running (PID: $FRONTEND_PID)"
echo "   🌐 URL: http://localhost:4005"
echo "   📝 Logs: /tmp/predimarket-test.log"
echo ""

echo "================================================"
echo "🎉 Test Environment Ready!"
echo "================================================"
echo ""
echo "Services Running:"
echo "  Anvil:      http://localhost:9545"
echo "  Indexer:    http://localhost:4350/graphql"
echo "  Frontend:   http://localhost:4005"
echo ""
echo "Run Tests:"
echo "  cd apps/predimarket"
echo "  bun run test:e2e            # Basic e2e tests"
echo "  bun run test:e2e:wallet     # Wallet tests (headful)"
echo "  bun run test                # All tests"
echo ""
echo "Press Ctrl+C to stop all services..."
echo ""

# Keep script running
wait

