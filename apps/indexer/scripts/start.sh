#!/bin/bash
set -e

echo "🚀 Starting Jeju Indexer"
echo "================================"
echo ""

# Check if database is running
if ! docker ps | grep -q squid-db-1; then
    echo "📊 Starting PostgreSQL database..."
    cd "$(dirname "$0")"
    bun run db:up
    sleep 5
    
    # Check if database exists
    if ! docker exec squid-db-1 psql -U postgres -lqt | cut -d \| -f 1 | grep -qw indexer; then
        echo "🔧 Creating database..."
        docker exec squid-db-1 psql -U postgres -c "CREATE DATABASE indexer;"
    fi
    
    echo "🔄 Running migrations..."
    bun run db:migrate
else
    echo "✅ Database already running"
fi

echo ""
echo "🏗️  Building project..."
bun run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Starting services..."
echo "  - Processor: Indexing blockchain data"
  - GraphQL API: http://localhost:4350/graphql"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start processor and API in parallel
bun run dev

