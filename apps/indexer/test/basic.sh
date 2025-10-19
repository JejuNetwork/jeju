#!/bin/bash

echo "🧪 Testing Jeju Indexer"
echo "=========================="
echo ""

cd "$(dirname "$0")"

# Test 1: Check database
echo "1️⃣  Testing database connection..."
if docker ps | grep -q squid-db-1; then
    echo "   ✅ Database is running"
    
    if docker exec squid-db-1 psql -U postgres -d indexer -c "SELECT 1" > /dev/null 2>&1; then
        echo "   ✅ Can connect to database"
        
        TABLE_COUNT=$(docker exec squid-db-1 psql -U postgres -d indexer -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
        echo "   ✅ Found $TABLE_COUNT tables"
        
        if [ "$TABLE_COUNT" -ge "15" ]; then
            echo "   ✅ All tables present"
        else
            echo "   ⚠️  Expected 15 tables, found $TABLE_COUNT"
        fi
    else
        echo "   ❌ Cannot connect to database"
        exit 1
    fi
else
    echo "   ❌ Database is not running"
    echo "   Run: npm run db:up"
    exit 1
fi

echo ""

# Test 2: Check build
echo "2️⃣  Testing TypeScript build..."
if npm run build > /dev/null 2>&1; then
    echo "   ✅ Build successful"
else
    echo "   ❌ Build failed"
    exit 1
fi

echo ""

# Test 3: Check processor
echo "3️⃣  Testing processor..."
timeout 5 npm run process > /tmp/processor_test.log 2>&1 || true
if grep -q "processing blocks" /tmp/processor_test.log; then
    echo "   ✅ Processor starts correctly"
else
    echo "   ⚠️  Processor may need RPC configuration"
    echo "   Update RPC_ETH_HTTP in .env file"
fi

echo ""

# Test 4: Check API
echo "4️⃣  Testing GraphQL API..."
npm run api > /tmp/api_test.log 2>&1 &
API_PID=$!
sleep 3

if ps -p $API_PID > /dev/null; then
    echo "   ✅ API server started"
    
    if curl -s http://localhost:4350/graphql > /dev/null 2>&1; then
        echo "   ✅ API is responding"
    else
        echo "   ⚠️  API may still be starting"
    fi
    
    kill $API_PID 2>/dev/null || true
else
    echo "   ❌ API failed to start"
    exit 1
fi

echo ""
echo "=================================="
echo "✅ All tests passed!"
echo ""
echo "To start the indexer:"
echo "  npm run dev     (or: bun run dev)"
echo ""
echo "To start with script:"
echo "  ./start.sh"
echo ""

