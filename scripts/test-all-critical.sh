#!/bin/bash
# Complete Test Suite for Critical Services
# Runs ALL tests for indexer, IPFS, and monitoring

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🧪 COMPLETE TEST SUITE - ALL CRITICAL SERVICES             ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Check if services are running
echo -e "${CYAN}Checking service availability...${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

LOCALNET_RUNNING=false
INDEXER_RUNNING=false
IPFS_RUNNING=false
GRAFANA_RUNNING=false
PROMETHEUS_RUNNING=false

if curl -s http://localhost:9545 > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Localnet RPC (port 9545)${NC}"
    LOCALNET_RUNNING=true
else
    echo -e "  ${YELLOW}⚠️  Localnet not running${NC}"
fi

if curl -s http://localhost:4350/graphql > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Indexer GraphQL (port 4350)${NC}"
    INDEXER_RUNNING=true
else
    echo -e "  ${YELLOW}⚠️  Indexer not running${NC}"
fi

if curl -s http://localhost:3100/health > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ IPFS Service (port 3100)${NC}"
    IPFS_RUNNING=true
else
    echo -e "  ${YELLOW}⚠️  IPFS not running${NC}"
fi

if curl -s http://localhost:4010/api/health > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Grafana (port 4010)${NC}"
    GRAFANA_RUNNING=true
else
    echo -e "  ${YELLOW}⚠️  Grafana not running${NC}"
fi

if curl -s http://localhost:9090/api/v1/targets > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Prometheus (port 9090)${NC}"
    PROMETHEUS_RUNNING=true
else
    echo -e "  ${YELLOW}⚠️  Prometheus not running${NC}"
fi

echo ""

# ============================================================================
# RUN TESTS
# ============================================================================

echo -e "${CYAN}Running test suites...${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Monitoring Tests (always runnable)
echo -e "${CYAN}1️⃣  Monitoring Stack Tests${NC}"
if bun test apps/monitoring/test/monitoring.test.ts > /tmp/monitoring-tests.log 2>&1; then
    PASSED=$(grep -o "[0-9]* pass" /tmp/monitoring-tests.log | grep -o "[0-9]*" | head -1 || echo "0")
    echo -e "  ${GREEN}✅ PASSED ($PASSED tests)${NC}"
    PASSED_TESTS=$((PASSED_TESTS + PASSED))
    TOTAL_TESTS=$((TOTAL_TESTS + PASSED))
else
    echo -e "  ${RED}❌ FAILED${NC} - see /tmp/monitoring-tests.log"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
fi
echo ""

# 2. Cross-Service Integration Tests (always runnable, graceful degradation)
echo -e "${CYAN}2️⃣  Cross-Service Integration Tests${NC}"
if bun test tests/integration/services-integration.test.ts > /tmp/integration-tests.log 2>&1; then
    PASSED=$(grep -o "[0-9]* pass" /tmp/integration-tests.log | grep -o "[0-9]*" | head -1 || echo "0")
    echo -e "  ${GREEN}✅ PASSED ($PASSED tests)${NC}"
    PASSED_TESTS=$((PASSED_TESTS + PASSED))
    TOTAL_TESTS=$((TOTAL_TESTS + PASSED))
else
    echo -e "  ${RED}❌ FAILED${NC} - see /tmp/integration-tests.log"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
fi
echo ""

# 3. IPFS Database Tests (requires PostgreSQL on port 5432)
echo -e "${CYAN}3️⃣  IPFS Database Tests${NC}"
if nc -z localhost 5432 2>/dev/null; then
    cd apps/ipfs/pinning-api
    if bun test src/ipfs.test.ts > /tmp/ipfs-db-tests.log 2>&1; then
        PASSED=$(grep -o "[0-9]* pass" /tmp/ipfs-db-tests.log | grep -o "[0-9]*" | head -1 || echo "0")
        echo -e "  ${GREEN}✅ PASSED ($PASSED tests)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + PASSED))
        TOTAL_TESTS=$((TOTAL_TESTS + PASSED))
    else
        echo -e "  ${RED}❌ FAILED${NC} - see /tmp/ipfs-db-tests.log"
        FAILED=$(grep -o "[0-9]* fail" /tmp/ipfs-db-tests.log | grep -o "[0-9]*" | head -1 || echo "1")
        FAILED_TESTS=$((FAILED_TESTS + FAILED))
        TOTAL_TESTS=$((TOTAL_TESTS + FAILED))
    fi
    cd ../../..
else
    echo -e "  ${YELLOW}⏭️  SKIPPED (PostgreSQL not running on port 5432)${NC}"
    echo -e "     ${YELLOW}Note: squid-db-1 is on port 23798, IPFS needs 5432${NC}"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 8))
fi
echo ""

# 4. IPFS A2A Tests (requires service)
echo -e "${CYAN}4️⃣  IPFS A2A Tests${NC}"
if [ "$IPFS_RUNNING" = true ]; then
    cd apps/ipfs/pinning-api
    if bun test src/a2a.test.ts > /tmp/ipfs-a2a-tests.log 2>&1; then
        PASSED=$(grep -o "([0-9]*) pass" /tmp/ipfs-a2a-tests.log | grep -o "[0-9]*" || echo "0")
        echo -e "  ${GREEN}✅ PASSED ($PASSED tests)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + PASSED))
        TOTAL_TESTS=$((TOTAL_TESTS + PASSED))
    else
        echo -e "  ${RED}❌ FAILED${NC} - see /tmp/ipfs-a2a-tests.log"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
    fi
    cd ../../..
else
    echo -e "  ${YELLOW}⏭️  SKIPPED (IPFS service not running)${NC}"
    echo -e "     ${YELLOW}Start with: cd apps/ipfs/pinning-api && bun run dev${NC}"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 7))
fi
echo ""

# 5. Indexer Integration Tests (requires indexer)
echo -e "${CYAN}5️⃣  Indexer Integration Tests${NC}"
if [ "$INDEXER_RUNNING" = true ]; then
    if bun test apps/indexer/test/integration.test.ts > /tmp/indexer-integration.log 2>&1; then
        PASSED=$(grep -o "[0-9]* pass" /tmp/indexer-integration.log | grep -o "[0-9]*" | head -1 || echo "0")
        echo -e "  ${GREEN}✅ PASSED ($PASSED tests)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + PASSED))
        TOTAL_TESTS=$((TOTAL_TESTS + PASSED))
    else
        echo -e "  ${RED}❌ FAILED${NC} - see /tmp/indexer-integration.log"
        FAILED=$(grep -o "[0-9]* fail" /tmp/indexer-integration.log | grep -o "[0-9]*" | head -1 || echo "1")
        FAILED_TESTS=$((FAILED_TESTS + FAILED))
        TOTAL_TESTS=$((TOTAL_TESTS + FAILED))
    fi
else
    echo -e "  ${YELLOW}⏭️  SKIPPED (Indexer not running)${NC}"
    echo -e "     ${YELLOW}Start with: bun run dev${NC}"
    SKIPPED_TESTS=$((SKIPPED_TESTS + 14))
fi
echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "TEST RESULTS SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  Total Tests Run:    ${TOTAL_TESTS}"
echo -e "  ${GREEN}✅ Passed:          ${PASSED_TESTS}${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "  ${RED}❌ Failed:          ${FAILED_TESTS}${NC}"
fi
if [ $SKIPPED_TESTS -gt 0 ]; then
    echo -e "  ${YELLOW}⏭️  Skipped:         ${SKIPPED_TESTS}${NC}"
fi
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ✅ ALL TESTS PASSED                                        ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ $SKIPPED_TESTS -gt 0 ]; then
        echo "Note: $SKIPPED_TESTS tests skipped due to services not running"
        echo ""
        echo "To run ALL tests:"
        echo "  1. Start services: bun run dev"
        echo "  2. Re-run this script: ./scripts/test-all-critical.sh"
        echo ""
    fi
    
    exit 0
else
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ❌ SOME TESTS FAILED                                       ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Check logs in /tmp/ directory"
    echo ""
    exit 1
fi

