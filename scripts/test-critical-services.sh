#!/bin/bash
# Critical Services Test Runner
# Tests indexer, IPFS, and monitoring in the correct order

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🧪 CRITICAL SERVICES TEST SUITE                            ║"
echo "║   Indexer → IPFS → Monitoring                                ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

FAILED=0
PASSED=0

# ============================================================================
# 1. INDEXER TESTS
# ============================================================================

echo "1️⃣  TESTING INDEXER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd apps/indexer

echo "   Running basic functionality test..."
if ./test/basic.sh > /tmp/indexer-basic.log 2>&1; then
    echo "   ✅ Indexer basic test PASSED"
    PASSED=$((PASSED + 1))
else
    echo "   ❌ Indexer basic test FAILED"
    echo "      See: /tmp/indexer-basic.log"
    FAILED=$((FAILED + 1))
fi

cd ../..

echo ""

# ============================================================================
# 2. IPFS TESTS
# ============================================================================

echo "2️⃣  TESTING IPFS SERVICE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd apps/ipfs/pinning-api

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "   📦 Installing IPFS dependencies..."
    bun install > /dev/null 2>&1
fi

echo "   Running database tests..."
if bun test src/ipfs.test.ts > /tmp/ipfs-db.log 2>&1; then
    echo "   ✅ IPFS database tests PASSED"
    PASSED=$((PASSED + 1))
else
    echo "   ❌ IPFS database tests FAILED"
    echo "      See: /tmp/ipfs-db.log"
    FAILED=$((FAILED + 1))
fi

echo "   Running A2A tests..."
if bun test src/a2a.test.ts > /tmp/ipfs-a2a.log 2>&1; then
    echo "   ✅ IPFS A2A tests PASSED"  
    PASSED=$((PASSED + 1))
else
    echo "   ⚠️  IPFS A2A tests need service running"
    echo "      (Start with: bun run dev in apps/ipfs/pinning-api)"
fi

echo "   Running health tests..."
if bun test src/health.test.ts > /tmp/ipfs-health.log 2>&1; then
    echo "   ✅ IPFS health tests PASSED"
    PASSED=$((PASSED + 1))
else
    echo "   ⚠️  IPFS health tests need service running"
fi

cd ../../..

echo ""

# ============================================================================
# 3. MONITORING TESTS
# ============================================================================

echo "3️⃣  TESTING MONITORING STACK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "   Running monitoring tests..."
if bun test apps/monitoring/test/monitoring.test.ts > /tmp/monitoring.log 2>&1; then
    echo "   ✅ Monitoring tests PASSED"
    PASSED=$((PASSED + 1))
else
    echo "   ⚠️  Monitoring tests need services running"
    echo "      (Start with: cd apps/monitoring && ./start-monitoring.sh)"
fi

echo ""

# ============================================================================
# 4. INTEGRATION TESTS
# ============================================================================

echo "4️⃣  TESTING SERVICE INTEGRATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "   Running cross-service integration tests..."
if bun test tests/integration/services-integration.test.ts > /tmp/integration.log 2>&1; then
    echo "   ✅ Integration tests PASSED"
    PASSED=$((PASSED + 1))
else
    echo "   ⚠️  Integration tests need all services running"
    echo "      (Start with: bun run dev)"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "═══════════════════════════════════════════════════════════════"
echo ""
if [ $FAILED -eq 0 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ✅ ALL CRITICAL SERVICE TESTS PASSED ($PASSED passed)          ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    exit 0
else
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ⚠️  SOME TESTS FAILED: $FAILED failed, $PASSED passed              ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Check logs in /tmp/ directory:"
    echo "  - /tmp/indexer-basic.log"
    echo "  - /tmp/ipfs-db.log"
    echo "  - /tmp/ipfs-a2a.log"
    echo "  - /tmp/monitoring.log"
    echo "  - /tmp/integration.log"
    echo ""
    exit 1
fi

