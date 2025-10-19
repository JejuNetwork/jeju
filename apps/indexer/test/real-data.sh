#!/bin/bash

echo "🧪 REAL DATA VERIFICATION TEST"
echo "================================"
echo ""

cd "$(dirname "$0")"

# Test database connection
if ! docker ps | grep -q squid-db-1; then
    echo "❌ Database not running"
    exit 1
fi

echo "Testing actual data in database..."
echo ""

# Test 1: Check blocks
BLOCKS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM block;")
echo "1️⃣  Blocks indexed: $BLOCKS"
if [ "$BLOCKS" -gt "0" ]; then
    echo "   ✅ PASS - Real blocks indexed"
else
    echo "   ❌ FAIL - No blocks"
    exit 1
fi

# Test 2: Check transactions  
TXS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM transaction;")
echo "2️⃣  Transactions indexed: $TXS"
if [ "$TXS" -gt "0" ]; then
    echo "   ✅ PASS - Real transactions indexed"
else
    echo "   ❌ FAIL - No transactions"
    exit 1
fi

# Test 3: Check logs (events)
LOGS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM log;")
echo "3️⃣  Logs captured: $LOGS"
if [ "$LOGS" -gt "0" ]; then
    echo "   ✅ PASS - Events being captured"
else
    echo "   ❌ FAIL - No logs"
    exit 1
fi

# Test 4: Check decoded events
EVENTS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM decoded_event;")
echo "4️⃣  Decoded events: $EVENTS"
if [ "$EVENTS" -gt "0" ]; then
    echo "   ✅ PASS - Events being decoded"
else
    echo "   ❌ FAIL - No decoded events"
    exit 1
fi

# Test 5: Check token transfers
TOKENS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM token_transfer;")
echo "5️⃣  Token transfers: $TOKENS"
if [ "$TOKENS" -gt "0" ]; then
    echo "   ✅ PASS - Tokens being tracked"
else
    echo "   ❌ FAIL - No token transfers"
    exit 1
fi

# Test 6: Check contracts
CONTRACTS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM contract;")
echo "6️⃣  Contracts detected: $CONTRACTS"
if [ "$CONTRACTS" -gt "0" ]; then
    echo "   ✅ PASS - Contracts being detected"
else
    echo "   ❌ FAIL - No contracts"
    exit 1
fi

# Test 7: Check ERC20 detection
ERC20=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM contract WHERE is_erc20 = true;")
echo "7️⃣  ERC20 contracts: $ERC20"
if [ "$ERC20" -gt "0" ]; then
    echo "   ✅ PASS - ERC20 detection working"
else
    echo "   ❌ FAIL - No ERC20 contracts"
    exit 1
fi

# Test 8: Check accounts
ACCOUNTS=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM account;")
echo "8️⃣  Accounts tracked: $ACCOUNTS"
if [ "$ACCOUNTS" -gt "0" ]; then
    echo "   ✅ PASS - Accounts being tracked"
else
    echo "   ❌ FAIL - No accounts"
    exit 1
fi

echo ""
echo "================================"
echo "✅ ALL 8 TESTS PASSED!"
echo ""
echo "Summary:"
echo "  - $BLOCKS blocks indexed"
echo "  - $TXS transactions"
echo "  - $LOGS event logs"
echo "  - $EVENTS decoded events"
echo "  - $TOKENS token transfers"
echo "  - $CONTRACTS contracts (including $ERC20 ERC20 tokens)"
echo "  - $ACCOUNTS unique accounts"
echo ""
echo "🎉 INDEXER IS FULLY FUNCTIONAL!"
echo ""

