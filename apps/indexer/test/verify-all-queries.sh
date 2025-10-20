#!/bin/bash

# Comprehensive GraphQL query verification script
# Tests all query types to ensure the indexer is fully functional

set -e

GRAPHQL_URL="http://localhost:4350/graphql"
PASS=0
FAIL=0

echo "🧪 Testing All Indexer GraphQL Queries"
echo "========================================"
echo ""

# Helper function to test a query
test_query() {
    local name="$1"
    local query="$2"
    
    echo -n "Testing $name... "
    
    response=$(curl -s -X POST "$GRAPHQL_URL" \
        -H "Content-Type: application/json" \
        -d "{\"query\":\"$query\"}")
    
    if echo "$response" | jq -e '.data' > /dev/null 2>&1; then
        echo "✅ PASS"
        ((PASS++))
        return 0
    else
        echo "❌ FAIL"
        echo "Response: $response"
        ((FAIL++))
        return 1
    fi
}

# Test all entity queries
test_query "Blocks" "{ blocks(limit: 1) { id number hash timestamp } }"
test_query "Transactions" "{ transactions(limit: 1) { id hash from { address } status } }"
test_query "Accounts" "{ accounts(limit: 1) { id address isContract transactionCount firstSeenAt lastSeenAt } }"
test_query "Contracts" "{ contracts(limit: 1, where: { isERC20_eq: true }) { id address isERC20 contractType firstSeenAt } }"
test_query "TokenTransfers" "{ tokenTransfers(limit: 1) { id tokenStandard from { address } to { address } timestamp } }"
test_query "Logs" "{ logs(limit: 1) { id topic0 address { address } block { number } } }"
test_query "DecodedEvents" "{ decodedEvents(limit: 1) { id eventName eventSignature timestamp } }"
test_query "TokenBalances" "{ tokenBalances(limit: 1) { id balance account { address } token { address } } }"
test_query "IPFSFiles" "{ ipfsFiles(limit: 1) { id cid owner category } }"
test_query "ModerationReports" "{ moderationReports(limit: 1) { id reportType severity status } }"
test_query "TEEAttestations" "{ teeAttestations(limit: 1) { id gameType verified } }"
test_query "NFTMetadata" "{ nftMetadata(limit: 1) { id tokenId contract owner } }"
test_query "AgentProfiles" "{ agentProfiles(limit: 1) { id agentId stakeTier } }"
test_query "ContestResults" "{ contestResults(limit: 1) { id winner finalized } }"
test_query "StorageStats" "{ storageStats(limit: 1) { id totalFiles totalSizeBytes } }"
test_query "Traces" "{ traces(limit: 1) { id type from { address } transaction { hash } } }"

# Test complex queries with filters
echo ""
echo "Testing Complex Queries..."
test_query "ERC20 Contracts" "{ contracts(where: { isERC20_eq: true }, limit: 10) { address } }"
test_query "ERC721 Contracts" "{ contracts(where: { isERC721_eq: true }, limit: 10) { address } }"
test_query "Recent Blocks" "{ blocks(orderBy: number_DESC, limit: 5) { number timestamp } }"
test_query "Contract Accounts" "{ accounts(where: { isContract_eq: true }, limit: 10) { address } }"
test_query "Active Accounts" "{ accounts(where: { transactionCount_gt: 0 }, limit: 10) { address transactionCount } }"

# Test nested queries
echo ""
echo "Testing Nested Queries..."
test_query "Block with Transactions" "{ blocks(limit: 1) { number transactions(limit: 1) { hash } } }"
test_query "Account with Transfers" "{ accounts(limit: 1) { address tokenTransfersFrom(limit: 1) { tokenStandard } } }"
test_query "Contract with Transfers" "{ contracts(limit: 1) { address tokenTransfers(limit: 1) { tokenStandard } } }"

echo ""
echo "========================================"
echo "Results: ✅ $PASS passed, ❌ $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "🎉 All queries working correctly!"
    exit 0
else
    echo "⚠️  Some queries failed"
    exit 1
fi

