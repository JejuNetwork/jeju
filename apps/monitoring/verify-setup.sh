#!/bin/bash

echo "🔍 Verifying Jeju Monitoring Setup..."
echo ""

ERRORS=0
WARNINGS=0

# Check Docker
echo "Checking Docker..."
if command -v docker &> /dev/null; then
    echo "✅ Docker is installed: $(docker --version)"
else
    echo "❌ Docker is not installed"
    ERRORS=$((ERRORS + 1))
fi

# Check Docker Compose
echo ""
echo "Checking Docker Compose..."
if command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose is installed: $(docker-compose --version)"
else
    echo "❌ Docker Compose is not installed"
    ERRORS=$((ERRORS + 1))
fi

# Check if containers are running
echo ""
echo "Checking monitoring containers..."

if docker ps | grep -q jeju-grafana; then
    echo "✅ Grafana container is running"
    GRAFANA_RUNNING=true
else
    echo "⚠️  Grafana container is not running"
    WARNINGS=$((WARNINGS + 1))
    GRAFANA_RUNNING=false
fi

if docker ps | grep -q jeju-prometheus; then
    echo "✅ Prometheus container is running"
    PROMETHEUS_RUNNING=true
else
    echo "⚠️  Prometheus container is not running"
    WARNINGS=$((WARNINGS + 1))
    PROMETHEUS_RUNNING=false
fi

# Check indexer database
echo ""
echo "Checking indexer database..."
if docker ps | grep -q squid-db-1; then
    echo "✅ Indexer database is running"
    INDEXER_RUNNING=true
else
    echo "⚠️  Indexer database is not running (PostgreSQL datasource won't work)"
    WARNINGS=$((WARNINGS + 1))
    INDEXER_RUNNING=false
fi

# Check if services are accessible
echo ""
echo "Checking service accessibility..."

GRAFANA_PORT=${GRAFANA_PORT:-4010}
PROMETHEUS_PORT=${PROMETHEUS_PORT:-9090}

if [ "$GRAFANA_RUNNING" = true ]; then
    if curl -s http://localhost:$GRAFANA_PORT > /dev/null; then
        echo "✅ Grafana is accessible at http://localhost:$GRAFANA_PORT"
    else
        echo "❌ Grafana is not accessible at http://localhost:$GRAFANA_PORT"
        ERRORS=$((ERRORS + 1))
    fi
fi

if [ "$PROMETHEUS_RUNNING" = true ]; then
    if curl -s http://localhost:$PROMETHEUS_PORT > /dev/null; then
        echo "✅ Prometheus is accessible at http://localhost:$PROMETHEUS_PORT"
    else
        echo "❌ Prometheus is not accessible at http://localhost:$PROMETHEUS_PORT"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check data sources
echo ""
echo "Checking dashboard files..."
DASHBOARD_COUNT=$(find grafana/dashboards -name "*.json" 2>/dev/null | wc -l)
if [ "$DASHBOARD_COUNT" -gt 0 ]; then
    echo "✅ Found $DASHBOARD_COUNT dashboard(s):"
    find grafana/dashboards -name "*.json" -exec basename {} \; | sed 's/^/   - /'
else
    echo "❌ No dashboards found"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "Checking datasource files..."
DATASOURCE_COUNT=$(find grafana/provisioning/datasources -name "*.yml" 2>/dev/null | wc -l)
if [ "$DATASOURCE_COUNT" -gt 0 ]; then
    echo "✅ Found $DATASOURCE_COUNT datasource(s):"
    find grafana/provisioning/datasources -name "*.yml" -exec basename {} \; | sed 's/^/   - /'
else
    echo "❌ No datasources found"
    ERRORS=$((ERRORS + 1))
fi

# Check network connectivity
if [ "$GRAFANA_RUNNING" = true ] && [ "$INDEXER_RUNNING" = true ]; then
    echo ""
    echo "Checking network connectivity..."
    
    # Check if Grafana can reach indexer database
    if docker exec jeju-grafana ping -c 1 squid-db-1 &> /dev/null; then
        echo "✅ Grafana can reach indexer database"
    else
        echo "⚠️  Grafana cannot reach indexer database"
        echo "   Run: docker network connect <indexer-network> jeju-grafana"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check Prometheus targets (if running)
if [ "$PROMETHEUS_RUNNING" = true ]; then
    echo ""
    echo "Checking Prometheus targets..."
    TARGETS=$(curl -s http://localhost:$PROMETHEUS_PORT/api/v1/targets 2>/dev/null)
    if [ -n "$TARGETS" ]; then
        UP_COUNT=$(echo "$TARGETS" | grep -o '"health":"up"' | wc -l)
        DOWN_COUNT=$(echo "$TARGETS" | grep -o '"health":"down"' | wc -l)
        echo "   Up: $UP_COUNT | Down: $DOWN_COUNT"
        if [ "$DOWN_COUNT" -gt 0 ]; then
            echo "⚠️  Some Prometheus targets are down"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════"
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo "✅ All checks passed! Monitoring stack is ready."
elif [ "$ERRORS" -eq 0 ]; then
    echo "⚠️  Setup has $WARNINGS warning(s) but should work."
else
    echo "❌ Setup has $ERRORS error(s) and $WARNINGS warning(s)."
    echo "   Please fix errors before proceeding."
fi
echo "═══════════════════════════════════════════════"

echo ""
echo "Quick actions:"
if [ "$GRAFANA_RUNNING" = false ] || [ "$PROMETHEUS_RUNNING" = false ]; then
    echo "  Start monitoring: ./start-monitoring.sh"
fi
if [ "$GRAFANA_RUNNING" = true ]; then
    echo "  Open Grafana: http://localhost:$GRAFANA_PORT"
fi
if [ "$PROMETHEUS_RUNNING" = true ]; then
    echo "  Open Prometheus: http://localhost:$PROMETHEUS_PORT"
fi
echo "  View logs: docker-compose logs -f"
echo "  Stop monitoring: docker-compose down"
echo ""

exit $ERRORS

