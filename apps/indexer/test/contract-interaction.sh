#!/bin/bash
set -e

echo "🔍 Contract Interaction Test"
echo "================================"
echo ""

cd "$(dirname "$0")"

# Prerequisites check
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo "❌ Localnet not running on port 8545"
    echo "   Start with: bun run localnet:start"
    exit 1
fi

if ! docker ps | grep -q squid-db-1; then
    echo "❌ Indexer database not running"
    echo "   Start with: npm run db:up"
    exit 1
fi

echo "✅ Prerequisites met"
echo ""

# Get initial state
INITIAL_BLOCKS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COALESCE(MAX(number), 0) FROM block;" 2>/dev/null || echo "0")
INITIAL_TXS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM transaction;" 2>/dev/null || echo "0")
INITIAL_LOGS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM log;" 2>/dev/null || echo "0")

echo "📊 Initial state:"
echo "   Blocks: $INITIAL_BLOCKS"
echo "   Transactions: $INITIAL_TXS"
echo "   Logs: $INITIAL_LOGS"
echo ""

# Start indexer
echo "🔄 Starting indexer..."
npm run process > /tmp/contract_test_indexer.log 2>&1 &
INDEXER_PID=$!
sleep 10

echo "✅ Indexer running (PID: $INDEXER_PID)"
echo ""

# Deploy a contract (using your existing scripts)
echo "📝 Deploying test contract..."
echo "   (This would use: bun run deploy:defi:local)"
echo "   Or interact with existing contracts"
echo ""

# Wait for indexing
echo "⏳ Waiting 30 seconds for indexing..."
sleep 30

# Check results
FINAL_BLOCKS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COALESCE(MAX(number), 0) FROM block;" 2>/dev/null || echo "0")
FINAL_TXS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM transaction;" 2>/dev/null || echo "0")
FINAL_LOGS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM log;" 2>/dev/null || echo "0")
FINAL_EVENTS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM decoded_event;" 2>/dev/null || echo "0")

echo ""
echo "📊 Final state:"
echo "   Blocks: $FINAL_BLOCKS (+" $(($FINAL_BLOCKS - $INITIAL_BLOCKS)) ")"
echo "   Transactions: $FINAL_TXS (+" $(($FINAL_TXS - $INITIAL_TXS)) ")"
echo "   Logs: $FINAL_LOGS (+" $(($FINAL_LOGS - $INITIAL_LOGS)) ")"
echo "   Events: $FINAL_EVENTS"
echo ""

# Verify indexing happened
if [ "$FINAL_BLOCKS" -gt "$INITIAL_BLOCKS" ]; then
    echo "✅ SUCCESS: Indexer captured $(($FINAL_BLOCKS - $INITIAL_BLOCKS)) new blocks!"
    
    # Show latest indexed transaction
    if [ "$FINAL_TXS" -gt "$INITIAL_TXS" ]; then
        echo ""
        echo "📋 Latest indexed transaction:"
        docker exec squid-db-1 psql -U postgres -d indexer -c \
            "SELECT hash, status FROM transaction ORDER BY id DESC LIMIT 1;" 2>/dev/null
    fi
    
    # Show latest event if any
    if [ "$FINAL_LOGS" -gt "$INITIAL_LOGS" ]; then
        echo ""
        echo "📋 Latest indexed event log:"
        docker exec squid-db-1 psql -U postgres -d indexer -c \
            "SELECT address, topic0 FROM log ORDER BY id DESC LIMIT 1;" 2>/dev/null
    fi
    
    RESULT=0
else
    echo "⚠️  No new blocks indexed"
    echo "   Check: tail -50 /tmp/contract_test_indexer.log"
    RESULT=1
fi

# Cleanup
kill $INDEXER_PID 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit $RESULT

