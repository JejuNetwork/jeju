#!/bin/bash
# Quick Deploy Script - Deploys everything in one go
#
# Prerequisites:
#   - PRIVATE_KEY set (wallet with Sepolia ETH)
#   - PINATA_API_KEY and PINATA_SECRET_KEY set (optional, for IPFS)
#   - foundry installed (forge)
#
# Usage: ./scripts/quick-deploy.sh

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "         BABYLON EXPERIMENTAL - QUICK DEPLOY                    "
echo "═══════════════════════════════════════════════════════════════"

cd "$(dirname "$0")/.."

# Check prerequisites
if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ PRIVATE_KEY not set"
    echo "   export PRIVATE_KEY=0x..."
    exit 1
fi

echo "✅ Private key set"

# Step 1: Deploy Contracts
echo ""
echo "Step 1: Deploying contracts to Sepolia..."
echo "─────────────────────────────────────────"

DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol:Deploy \
    --rpc-url https://ethereum-sepolia.publicnode.com \
    --broadcast \
    2>&1)

echo "$DEPLOY_OUTPUT"

# Extract addresses from output
TREASURY=$(echo "$DEPLOY_OUTPUT" | grep "GameTreasury deployed at:" | awk '{print $NF}')
FACTORY=$(echo "$DEPLOY_OUTPUT" | grep "RegistryFactory deployed at:" | awk '{print $NF}')
REGISTRY=$(echo "$DEPLOY_OUTPUT" | grep "UserRegistry deployed at:" | awk '{print $NF}')

if [ -n "$TREASURY" ]; then
    echo ""
    echo "✅ Contracts deployed!"
    echo "   GameTreasury: $TREASURY"
    echo "   RegistryFactory: $FACTORY"  
    echo "   UserRegistry: $REGISTRY"
    
    # Update frontend config
    echo ""
    echo "Step 2: Updating frontend config..."
    echo "─────────────────────────────────────────"
    
    sed -i "s/gameTreasury: '0x0000000000000000000000000000000000000000'/gameTreasury: '$TREASURY'/" frontend/app.production.js
    sed -i "s/userRegistry: '0x0000000000000000000000000000000000000000'/userRegistry: '$REGISTRY'/" frontend/app.production.js
    
    echo "✅ Frontend config updated"
else
    echo "⚠️ Could not parse contract addresses from output"
    echo "   Please update frontend/app.production.js manually"
fi

# Step 3: Upload to IPFS (if Pinata configured)
echo ""
echo "Step 3: IPFS Upload..."
echo "─────────────────────────────────────────"

if [ -n "$PINATA_API_KEY" ] && [ -n "$PINATA_SECRET_KEY" ]; then
    echo "Uploading frontend to Pinata..."
    
    # Create temp zip of frontend
    cd frontend
    zip -r ../frontend.zip .
    cd ..
    
    IPFS_RESPONSE=$(curl -s -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
        -H "pinata_api_key: $PINATA_API_KEY" \
        -H "pinata_secret_api_key: $PINATA_SECRET_KEY" \
        -F "file=@frontend.zip" \
        -F "pinataMetadata={\"name\":\"jeju-compute-frontend\"}")
    
    CID=$(echo "$IPFS_RESPONSE" | grep -o '"IpfsHash":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$CID" ]; then
        echo "✅ Frontend uploaded to IPFS!"
        echo "   CID: $CID"
        echo "   URL: https://gateway.pinata.cloud/ipfs/$CID"
        echo ""
        echo "To set ENS content hash:"
        echo "   export ENS_NAME=your-name"
        echo "   bun run register:ens set-ipfs \$ENS_NAME $CID"
    else
        echo "⚠️ IPFS upload failed: $IPFS_RESPONSE"
    fi
    
    rm -f frontend.zip
else
    echo "⚠️ Skipping IPFS (PINATA_API_KEY not set)"
    echo "   Set PINATA_API_KEY and PINATA_SECRET_KEY to enable"
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    DEPLOYMENT COMPLETE                         "
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Deployed Contracts:"
echo "  GameTreasury:    ${TREASURY:-'Check forge output'}"
echo "  RegistryFactory: ${FACTORY:-'Check forge output'}"
echo "  UserRegistry:    ${REGISTRY:-'Check forge output'}"
echo ""
echo "Frontend:"
echo "  IPFS CID:        ${CID:-'Not uploaded (set PINATA_API_KEY)'}"
echo ""
echo "Next steps:"
echo "  1. Fund treasury: cast send $TREASURY --value 0.01ether"
echo "  2. Register operator: bun run demo:autonomous"
echo "  3. Set ENS: bun run register:ens set-ipfs <name> $CID"
echo ""

