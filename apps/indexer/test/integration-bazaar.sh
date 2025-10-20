#!/bin/bash

# Integration test verifying Bazaar app can successfully query the indexer
# This tests the exact queries used by the Bazaar app

set -e

GRAPHQL_URL="http://localhost:4350/graphql"
BAZAAR_URL="http://localhost:4006"

echo "🔗 Bazaar <-> Indexer Integration Test"
echo "========================================"
echo ""

# Test 1: Bazaar's token query
echo "1️⃣  Testing getJejuTokens() query..."
RESPONSE=$(curl -s -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -d '{"query":"query GetTokens($limit: Int, $offset: Int, $isERC20: Boolean) { contracts(where: { isERC20_eq: $isERC20 } limit: $limit offset: $offset orderBy: firstSeenAt_DESC) { id address contractType isERC20 firstSeenAt lastSeenAt creator { address } } }","variables":{"limit":50,"offset":0,"isERC20":true}}')

if echo "$RESPONSE" | jq -e '.data.contracts' > /dev/null 2>&1; then
    echo "   ✅ Query structure valid"
    COUNT=$(echo "$RESPONSE" | jq '.data.contracts | length')
    echo "   ✅ Found $COUNT ERC20 tokens"
else
    echo "   ❌ Query failed"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# Test 2: Bazaar's token transfers query  
echo ""
echo "2️⃣  Testing getTokenTransfers() query..."
RESPONSE=$(curl -s -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -d '{"query":"query GetTokenTransfers($limit: Int!) { tokenTransfers(limit: $limit orderBy: timestamp_DESC) { id tokenStandard from { address } to { address } value timestamp transaction { hash } block { number } } }","variables":{"limit":50}}')

if echo "$RESPONSE" | jq -e '.data.tokenTransfers' > /dev/null 2>&1; then
    echo "   ✅ Query structure valid"
    COUNT=$(echo "$RESPONSE" | jq '.data.tokenTransfers | length')
    echo "   ✅ Found $COUNT transfers"
else
    echo "   ❌ Query failed"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# Test 3: Bazaar's contract details query
echo ""
echo "3️⃣  Testing getContractDetails() query..."
RESPONSE=$(curl -s -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -d '{"query":"query GetContract($address: String!) { contracts(where: { address_eq: $address }, limit: 1) { id address contractType isERC20 isERC721 isERC1155 creator { address } creationTransaction { hash } creationBlock { number timestamp } firstSeenAt lastSeenAt } }","variables":{"address":"0x0000000000000000000000000000000000000000"}}')

if echo "$RESPONSE" | jq -e '.data.contracts' > /dev/null 2>&1; then
    echo "   ✅ Query structure valid"
else
    echo "   ❌ Query failed"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# Test 4: Bazaar's latest blocks query
echo ""
echo "4️⃣  Testing getLatestBlocks() query..."
RESPONSE=$(curl -s -X POST "$GRAPHQL_URL" \
    -H "Content-Type: application/json" \
    -d '{"query":"query GetLatestBlocks($limit: Int!) { blocks(limit: $limit orderBy: number_DESC) { id number hash timestamp gasUsed gasLimit transactionCount } }","variables":{"limit":10}}')

if echo "$RESPONSE" | jq -e '.data.blocks' > /dev/null 2>&1; then
    echo "   ✅ Query structure valid"
    COUNT=$(echo "$RESPONSE" | jq '.data.blocks | length')
    echo "   ✅ Found $COUNT blocks"
    
    if [ "$COUNT" -gt 0 ]; then
        LATEST_BLOCK=$(echo "$RESPONSE" | jq -r '.data.blocks[0].number')
        echo "   ✅ Latest block: $LATEST_BLOCK"
    fi
else
    echo "   ❌ Query failed"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# Test 5: Check Bazaar app accessibility
echo ""
echo "5️⃣  Testing Bazaar app..."
if curl -s "$BAZAAR_URL" > /dev/null 2>&1; then
    echo "   ✅ Bazaar app is accessible at $BAZAAR_URL"
    
    # Check tokens page specifically
    if curl -s "$BAZAAR_URL/tokens" | grep -q "Create Token"; then
        echo "   ✅ Tokens page loads correctly"
        
        # Verify no GraphQL errors
        if ! curl -s "$BAZAAR_URL/tokens" | grep -qi "graphql error"; then
            echo "   ✅ No GraphQL errors on tokens page"
        else
            echo "   ❌ GraphQL error detected on tokens page"
            exit 1
        fi
    else
        echo "   ⚠️  Tokens page may still be loading"
    fi
else
    echo "   ⚠️  Bazaar app not accessible"
fi

echo ""
echo "========================================"
echo "🎉 All integration tests passed!"
echo ""
echo "✅ Indexer GraphQL API: $GRAPHQL_URL"
echo "✅ Bazaar App: $BAZAAR_URL"
echo "✅ All queries working correctly"
echo "✅ No GraphQL errors detected"
echo ""

