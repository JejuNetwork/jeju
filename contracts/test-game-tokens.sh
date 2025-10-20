#!/bin/bash
# Isolated test runner for game token system
# Avoids compilation errors in other contracts

echo "🧪 Testing Game Token System..."
echo ""

# Test just our contracts
forge test --match-contract GameTokensTest -vv 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ ALL GAME TOKEN TESTS PASSED"
else
    echo ""
    echo "❌ SOME TESTS FAILED"
    exit 1
fi
