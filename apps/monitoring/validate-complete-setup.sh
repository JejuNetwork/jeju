#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🔍 COMPLETE MONITORING SETUP VALIDATION                    ║"
echo "║   Critical assessment for out-of-the-box experience          ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

ERRORS=0
WARNINGS=0

# ============================================================================
# 1. CONFIGURATION FILES
# ============================================================================

echo "1️⃣  CONFIGURATION FILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check docker-compose.yml
if [ -f "docker-compose.yml" ]; then
    echo "✅ docker-compose.yml exists"
else
    echo "❌ docker-compose.yml missing"
    ERRORS=$((ERRORS + 1))
fi

# Check prometheus config
if [ -f "prometheus/prometheus.yml" ]; then
    echo "✅ prometheus/prometheus.yml exists"
else
    echo "❌ prometheus/prometheus.yml missing"
    ERRORS=$((ERRORS + 1))
fi

# Check datasource configs
if [ -f "grafana/provisioning/datasources/prometheus.yml" ]; then
    echo "✅ Prometheus datasource config exists"
    if grep -q "uid: prometheus" grafana/provisioning/datasources/prometheus.yml; then
        echo "   ✅ UID configured correctly"
    else
        echo "   ❌ UID not set"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "❌ Prometheus datasource config missing"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "grafana/provisioning/datasources/postgres.yml" ]; then
    echo "✅ PostgreSQL datasource config exists"
    if grep -q "uid: postgres-indexer" grafana/provisioning/datasources/postgres.yml; then
        echo "   ✅ UID configured correctly"
    else
        echo "   ❌ UID not set"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "❌ PostgreSQL datasource config missing"
    ERRORS=$((ERRORS + 1))
fi

# Check dashboard provisioning
if [ -f "grafana/provisioning/dashboards/dashboards.yml" ]; then
    echo "✅ Dashboard provisioning config exists"
else
    echo "❌ Dashboard provisioning config missing"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# ============================================================================
# 2. DASHBOARDS
# ============================================================================

echo "2️⃣  DASHBOARD FILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DASHBOARD_COUNT=$(find grafana/dashboards -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
if [ "$DASHBOARD_COUNT" -eq "9" ]; then
    echo "✅ Found $DASHBOARD_COUNT dashboards (expected 9)"
else
    echo "⚠️  Found $DASHBOARD_COUNT dashboards (expected 9)"
    WARNINGS=$((WARNINGS + 1))
fi

# Validate each dashboard has UID
echo "   Checking dashboard UIDs..."
for dashboard in grafana/dashboards/*.json; do
    filename=$(basename "$dashboard")
    if grep -q '"uid":' "$dashboard"; then
        echo "   ✅ $filename has UID"
    else
        echo "   ❌ $filename missing UID"
        ERRORS=$((ERRORS + 1))
    fi
done

# Validate JSON syntax
echo "   Validating JSON syntax..."
JSON_ERRORS=0
for dashboard in grafana/dashboards/*.json; do
    filename=$(basename "$dashboard")
    if python3 -m json.tool "$dashboard" > /dev/null 2>&1; then
        : # Valid, do nothing
    else
        echo "   ❌ $filename has invalid JSON"
        JSON_ERRORS=$((JSON_ERRORS + 1))
    fi
done

if [ "$JSON_ERRORS" -eq "0" ]; then
    echo "   ✅ All dashboards have valid JSON"
else
    echo "   ❌ $JSON_ERRORS dashboards have invalid JSON"
    ERRORS=$((ERRORS + JSON_ERRORS))
fi

# Check datasource references
echo "   Checking datasource UIDs in dashboards..."
PROMETHEUS_REFS=$(grep -r '"uid": "prometheus"' grafana/dashboards/ | wc -l | tr -d ' ')
POSTGRES_REFS=$(grep -r '"uid": "postgres-indexer"' grafana/dashboards/ | wc -l | tr -d ' ')

echo "   ✅ Found $PROMETHEUS_REFS Prometheus datasource references"
echo "   ✅ Found $POSTGRES_REFS PostgreSQL datasource references"

if [ "$POSTGRES_REFS" -gt "50" ]; then
    echo "   ✅ PostgreSQL datasource properly used"
else
    echo "   ⚠️  PostgreSQL datasource references seem low"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ============================================================================
# 3. NETWORK CONFIGURATION
# ============================================================================

echo "3️⃣  NETWORK CONFIGURATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if grep -q "extra_hosts:" docker-compose.yml; then
    echo "✅ Extra hosts configured (for host.docker.internal)"
else
    echo "⚠️  Extra hosts not configured"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "jeju-monitoring" docker-compose.yml; then
    echo "✅ jeju-monitoring network defined"
else
    echo "❌ jeju-monitoring network missing"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# ============================================================================
# 4. SCRIPTS
# ============================================================================

echo "4️⃣  SCRIPTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -x "start-monitoring.sh" ]; then
    echo "✅ start-monitoring.sh is executable"
else
    echo "❌ start-monitoring.sh not executable or missing"
    ERRORS=$((ERRORS + 1))
fi

if [ -x "verify-setup.sh" ]; then
    echo "✅ verify-setup.sh is executable"
else
    echo "⚠️  verify-setup.sh not executable"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ============================================================================
# 5. DOCUMENTATION
# ============================================================================

echo "5️⃣  DOCUMENTATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DOCS=(
    "README.md"
    "SETUP_COMPLETE.md"
    "VERIFICATION.md"
    "CONTRACT_EVENTS_COVERAGE.md"
    "COMPLETE_SETUP_SUMMARY.md"
    "README_SIMPLE.md"
    "TEST_SETUP.md"
)

DOC_COUNT=0
for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        DOC_COUNT=$((DOC_COUNT + 1))
    fi
done

echo "✅ Found $DOC_COUNT/$((${#DOCS[@]})) documentation files"

if [ "$DOC_COUNT" -ge 5 ]; then
    echo "   ✅ Comprehensive documentation available"
else
    echo "   ⚠️  Some documentation missing"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ============================================================================
# 6. RUNTIME CHECK (if containers running)
# ============================================================================

echo "6️⃣  RUNTIME CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if docker ps | grep -q jeju-grafana; then
    echo "✅ Grafana container is running"
    
    # Check if Grafana is responding
    if curl -s http://localhost:4010/api/health > /dev/null 2>&1; then
        echo "   ✅ Grafana API is responding"
    else
        echo "   ⚠️  Grafana API not responding yet (may still be starting)"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    # Check if Grafana can reach database
    if docker exec jeju-grafana ping -c 1 squid-db-1 > /dev/null 2>&1; then
        echo "   ✅ Grafana can reach indexer database"
    else
        echo "   ⚠️  Grafana cannot reach indexer database"
        echo "      (Will be connected on startup by start-monitoring.sh)"
    fi
else
    echo "ℹ️  Grafana not running (start with ./start-monitoring.sh)"
fi

if docker ps | grep -q jeju-prometheus; then
    echo "✅ Prometheus container is running"
    
    if curl -s http://localhost:9090/api/v1/targets > /dev/null 2>&1; then
        echo "   ✅ Prometheus API is responding"
    else
        echo "   ⚠️  Prometheus API not responding yet"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "ℹ️  Prometheus not running (start with ./start-monitoring.sh)"
fi

if docker ps | grep -q squid-db-1; then
    echo "✅ Indexer database is running"
else
    echo "ℹ️  Indexer database not running"
    echo "   PostgreSQL dashboards will show 'No data' until started"
    echo "   Start with: cd ../indexer && bun run dev"
fi

echo ""

# ============================================================================
# 7. SUMMARY
# ============================================================================

echo "═══════════════════════════════════════════════════════════════"
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ✅ PERFECT! Everything is configured correctly.            ║"
    echo "║                                                              ║"
    echo "║   Ready for out-of-the-box experience.                      ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
elif [ "$ERRORS" -eq 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ✅ READY with $WARNINGS warning(s)                           ║"
    echo "║                                                              ║"
    echo "║   Setup is functional. Warnings are non-critical.           ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
else
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   ❌ ISSUES FOUND: $ERRORS error(s), $WARNINGS warning(s)        ║"
    echo "║                                                              ║"
    echo "║   Please fix errors before proceeding.                      ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
fi

echo "Quick actions:"
if [ ! -d "../../../.git" ]; then
    echo "  Start monitoring: ./start-monitoring.sh"
fi
echo "  View logs: docker-compose logs -f"
echo "  Stop monitoring: docker-compose down"
echo "  Full verification: ./verify-setup.sh"
echo ""

exit $ERRORS

