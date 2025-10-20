#!/bin/bash

set -e

echo "🔍 Starting Jeju Monitoring Stack..."
echo ""

# Check if indexer database is running
echo "Checking if indexer database is running..."
if ! docker ps | grep -q squid-db-1; then
    echo "⚠️  Warning: Indexer database (squid-db-1) is not running."
    echo "   PostgreSQL datasource will not work until indexer is started."
    echo "   To start indexer: cd ../indexer && bun run dev"
    echo ""
    echo "   Continuing anyway - Prometheus dashboards will work..."
    echo ""
fi

# Ensure bridge network exists
echo "Ensuring Docker bridge network exists..."
docker network create bridge 2>/dev/null || true

# Start monitoring stack
echo "Starting Prometheus and Grafana..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 8

# Check if Grafana is running
if docker ps | grep -q jeju-grafana; then
    echo "✅ Grafana is running"
else
    echo "❌ Grafana failed to start"
    docker-compose logs grafana
    exit 1
fi

# Check if Prometheus is running
if docker ps | grep -q jeju-prometheus; then
    echo "✅ Prometheus is running"
else
    echo "❌ Prometheus failed to start"
    docker-compose logs prometheus
    exit 1
fi

# Connect Grafana to default bridge network for database access
echo "Connecting Grafana to bridge network..."
docker network connect bridge jeju-grafana 2>/dev/null || echo "  Already connected"

# Also try to connect to any indexer-specific networks
for network in $(docker network ls --format '{{.Name}}' | grep -E 'squid|indexer'); do
    echo "Connecting Grafana to $network..."
    docker network connect "$network" jeju-grafana 2>/dev/null || echo "  Already connected"
done

echo ""
echo "🎉 Monitoring stack is ready!"
echo ""
echo "📊 Grafana Dashboard: http://localhost:${GRAFANA_PORT:-4010}"
echo "   Username: admin"
echo "   Password: admin"
echo ""
echo "📈 Prometheus: http://localhost:${PROMETHEUS_PORT:-9090}"
echo ""
echo "Available Dashboards:"
echo "  • Jeju - Complete Overview"
echo "  • Blockchain Activity"
echo "  • Events & Logs Explorer"
echo "  • Contracts & DeFi Activity"
echo "  • Prediction Markets"
echo "  • Accounts & Token Transfers"
echo "  • OP Stack Overview"
echo "  • Subsquid Indexer Overview"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f"
echo ""
echo "To stop:"
echo "  docker-compose down"
echo ""

