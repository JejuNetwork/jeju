# Testnet Deployment Runbook

**Version**: 1.0.0
**Last Updated**: 2025-10-18
**Target Network**: Jeju Testnet (Chain ID: 420690)

This runbook provides step-by-step instructions for deploying the complete Jeju ecosystem to testnet.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Setup](#environment-setup)
3. [Phase 1: Core Contracts](#phase-1-core-contracts)
4. [Phase 2: Uniswap V4 DEX](#phase-2-uniswap-v4-dex)
5. [Phase 3: Game Contracts](#phase-3-game-contracts)
6. [Phase 4: Verification & Testing](#phase-4-verification--testing)
7. [Phase 5: Frontend Integration](#phase-5-frontend-integration)
8. [Post-Deployment](#post-deployment)
9. [Rollback Procedures](#rollback-procedures)
10. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### Code Quality

- [ ] All tests passing: `forge test --summary`
  - Expected: 321/321 tests passing (100%)
  - Command: `cd contracts && forge test --summary`

- [ ] TypeScript compiles: `npx tsc --noEmit`
  - Expected: Zero errors
  - Command: `npx tsc --noEmit`

- [ ] Security analysis complete
  - Reviewed: `SECURITY_ANALYSIS_FINAL.md`
  - 20/25 security tests passing
  - No critical vulnerabilities

- [ ] Documentation updated
  - README.md includes V4 section
  - Pool initialization guide exists
  - All V2 references replaced with V4

### Environment Preparation

- [ ] Testnet RPC accessible
  - URL: `https://testnet-rpc.jeju.network`
  - Test: `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' https://testnet-rpc.jeju.network`
  - Expected response: `{"jsonrpc":"2.0","id":1,"result":"0x666b2"}` (420690 in hex)

- [ ] Deployer account funded
  - Minimum: 5 ETH for testnet
  - Check: `cast balance $DEPLOYER_ADDRESS --rpc-url https://testnet-rpc.jeju.network`

- [ ] Private key secured
  - Stored in: `.env` file (NOT committed to git)
  - Backup: Secure password manager
  - Format: `PRIVATE_KEY=0x...`

- [ ] Block explorer API key (optional)
  - For contract verification
  - Set: `ETHERSCAN_API_KEY=...` or `BASESCAN_API_KEY=...`

### Team Coordination

- [ ] Deployment window scheduled
  - Recommended: Low-traffic period
  - Duration: 2-3 hours
  - Team available for monitoring

- [ ] Communication channels ready
  - Slack/Discord for updates
  - Status page prepared

- [ ] Backup plan reviewed
  - Rollback procedures understood
  - Emergency contacts available

---

## Environment Setup

### 1. Set Environment Variables

Create `.env.testnet`:

```bash
# Network Configuration
JEJU_NETWORK=testnet
JEJU_RPC_URL=https://testnet-rpc.jeju.network
JEJU_CHAIN_ID=420690

# Deployer Account
PRIVATE_KEY=0x... # NEVER COMMIT THIS

# Contract Parameters
TREASURY_ADDRESS=0x...  # Your treasury address
MIN_PURCHASE_USD=10     # $10 minimum
MAX_PURCHASE_USD=100000 # $100k maximum

# Optional: Block Explorer
ETHERSCAN_API_KEY=...   # For contract verification
```

Load environment:

```bash
source .env.testnet
```

### 2. Verify Account Balance

```bash
# Check deployer balance
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY)
echo "Deployer: $DEPLOYER"

BALANCE=$(cast balance $DEPLOYER --rpc-url $JEJU_RPC_URL)
echo "Balance: $(cast --to-unit $BALANCE ether) ETH"

# Should have at least 5 ETH
if (( $(echo "$BALANCE < 5000000000000000000" | bc -l) )); then
    echo "❌ Insufficient balance! Need at least 5 ETH"
    exit 1
fi
```

### 3. Verify Network Connection

```bash
# Check chain ID
CHAIN_ID=$(cast chain-id --rpc-url $JEJU_RPC_URL)
echo "Chain ID: $CHAIN_ID"

if [ "$CHAIN_ID" != "420690" ]; then
    echo "❌ Wrong network! Expected 420690, got $CHAIN_ID"
    exit 1
fi

# Check block height
BLOCK=$(cast block-number --rpc-url $JEJU_RPC_URL)
echo "Current block: $BLOCK"

echo "✅ Network connection verified"
```

---

## Phase 1: Core Contracts

**Duration**: 30-45 minutes
**Gas Required**: ~2-3 ETH

### Step 1.1: Deploy elizaOS Token

```bash
cd contracts

echo "📝 Deploying elizaOS Token..."

bun run scripts/deploy-eliza-token.ts

# Expected output:
# ✅ Token deployed: 0x...
# 📝 Deployment saved: deployments/eliza-token-420690.json

# Save address for later
ELIZA_TOKEN=$(jq -r '.address' ../deployments/eliza-token-420690.json)
echo "elizaOS Token: $ELIZA_TOKEN"
```

**Verification**:

```bash
# Check token metadata
cast call $ELIZA_TOKEN "name()(string)" --rpc-url $JEJU_RPC_URL
# Expected: "elizaOS Token"

cast call $ELIZA_TOKEN "symbol()(string)" --rpc-url $JEJU_RPC_URL
# Expected: "elizaOS"

cast call $ELIZA_TOKEN "totalSupply()(uint256)" --rpc-url $JEJU_RPC_URL
# Expected: 1000000000000000000000000000 (1 billion * 1e18)
```

**Checkpoint**: ✅ elizaOS Token deployed and verified

---

### Step 1.2: Deploy Price Oracle

```bash
echo "📝 Deploying Price Oracle..."

# Deploy oracle contract
forge create \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --broadcast \
    src/oracle/PriceOracle.sol:PriceOracle \
    --constructor-args \
    $DEPLOYER  # Initial owner

# Extract deployed address from logs
ORACLE_ADDRESS=$(forge script script/GetLastDeployment.s.sol --sig "run()" | grep "Deployed to:" | awk '{print $3}')

echo "Price Oracle: $ORACLE_ADDRESS"

# Save to deployment file
echo "{
  \"oracle\": \"$ORACLE_ADDRESS\",
  \"deployer\": \"$DEPLOYER\",
  \"chainId\": 420690,
  \"timestamp\": $(date +%s),
  \"deployedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}" > ../deployments/oracle-420690.json
```

**Verification**:

```bash
# Verify oracle has code
CODE=$(cast code $ORACLE_ADDRESS --rpc-url $JEJU_RPC_URL)
if [ ${#CODE} -lt 10 ]; then
    echo "❌ Oracle not deployed correctly"
    exit 1
fi

echo "✅ Oracle deployed with $(echo $CODE | wc -c) bytes"
```

**Checkpoint**: ✅ Price Oracle deployed

---

### Step 1.3: Deploy Credit Purchase Contract

```bash
echo "📝 Deploying Credit Purchase Contract..."

forge create \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --broadcast \
    src/cloud/CreditPurchaseContract.sol:CreditPurchaseContract \
    --constructor-args \
    $ELIZA_TOKEN \
    $ORACLE_ADDRESS \
    $TREASURY_ADDRESS

CREDIT_CONTRACT=$(forge script script/GetLastDeployment.s.sol --sig "run()" | grep "Deployed to:" | awk '{print $3}')

echo "Credit Purchase Contract: $CREDIT_CONTRACT"

# Save deployment
echo "{
  \"creditPurchase\": \"$CREDIT_CONTRACT\",
  \"elizaToken\": \"$ELIZA_TOKEN\",
  \"oracle\": \"$ORACLE_ADDRESS\",
  \"treasury\": \"$TREASURY_ADDRESS\",
  \"chainId\": 420690,
  \"timestamp\": $(date +%s)
}" > ../deployments/credit-purchase-420690.json
```

**Configuration**:

```bash
# Set supported tokens (USDC, USDT, DAI)
USDC_ADDRESS=0x...  # Testnet USDC address
USDT_ADDRESS=0x...  # Testnet USDT address
DAI_ADDRESS=0x...   # Testnet DAI address

# Enable USDC (6 decimals)
cast send $CREDIT_CONTRACT \
    "setTokenSupport(address,bool,uint8)" \
    $USDC_ADDRESS true 6 \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY

# Enable USDT (6 decimals)
cast send $CREDIT_CONTRACT \
    "setTokenSupport(address,bool,uint8)" \
    $USDT_ADDRESS true 6 \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY

# Enable DAI (18 decimals)
cast send $CREDIT_CONTRACT \
    "setTokenSupport(address,bool,uint8)" \
    $DAI_ADDRESS true 18 \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY

echo "✅ Payment tokens configured"
```

**Checkpoint**: ✅ Credit Purchase Contract deployed and configured

---

## Phase 2: Uniswap V4 DEX

**Duration**: 45-60 minutes
**Gas Required**: ~1-2 ETH

### Step 2.1: Deploy PoolManager

```bash
echo "📝 Deploying Uniswap V4 PoolManager..."

export JEJU_NETWORK=testnet
export JEJU_RPC_URL=https://testnet-rpc.jeju.network

bun run scripts/deploy-uniswap-v4.ts

# Expected output:
# ✅ PoolManager deployed: 0x...
# 📝 Deployment saved: contracts/deployments/uniswap-v4-420690.json

POOL_MANAGER=$(jq -r '.poolManager' deployments/uniswap-v4-420690.json)
echo "PoolManager: $POOL_MANAGER"
```

**Verification**:

```bash
# Verify PoolManager deployment
bun run scripts/verify-uniswap-v4-deployment.ts --network testnet

# Expected output:
# ✅ All verification checks passed!
# PoolManager: 0x...
# Owner: 0x...
# WETH: 0x4200000000000000000000000000000000000006
```

**Checkpoint**: ✅ Uniswap V4 PoolManager deployed

---

### Step 2.2: Deploy V4 Periphery

```bash
echo "📝 Deploying V4 Periphery Contracts..."

cd contracts

# Install v4-periphery if not already installed
forge install Uniswap/v4-periphery

# Deploy PositionManager
forge create \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --use 0.8.26 \
    --broadcast \
    lib/v4-periphery/src/PositionManager.sol:PositionManager \
    --constructor-args $POOL_MANAGER

POSITION_MANAGER=$(forge script script/GetLastDeployment.s.sol --sig "run()" | grep "Deployed to:" | awk '{print $3}')

echo "PositionManager: $POSITION_MANAGER"

# Update deployment file
jq --arg pm "$POSITION_MANAGER" '.positionManager = $pm' \
    ../deployments/uniswap-v4-420690.json > tmp.json && \
    mv tmp.json ../deployments/uniswap-v4-420690.json
```

**Checkpoint**: ✅ V4 Periphery deployed

---

### Step 2.3: Initialize ELIZA/ETH Pool

```bash
echo "📝 Initializing ELIZA/ETH Pool..."

# Ensure tokens are sorted (token0 < token1)
WETH=0x4200000000000000000000000000000000000006

if [[ "$WETH" < "$ELIZA_TOKEN" ]]; then
    TOKEN0=$WETH
    TOKEN1=$ELIZA_TOKEN
else
    TOKEN0=$ELIZA_TOKEN
    TOKEN1=$WETH
fi

echo "Token0: $TOKEN0"
echo "Token1: $TOKEN1"

# Calculate initial price: 1 ELIZA = 0.0001 ETH
# sqrtPriceX96 = sqrt(0.0001) * 2^96 = 792281625142643375935439503
SQRT_PRICE_X96=792281625142643375935439503

# Initialize pool through PositionManager
# (Requires Solidity script - see documentation/developers/uniswap-v4-pool-initialization.md)

echo "⚠️  Pool initialization requires v4-periphery integration"
echo "📖 See: documentation/developers/uniswap-v4-pool-initialization.md"
```

**Manual Step**: Follow the pool initialization guide to:
1. Create a Forge script for pool initialization
2. Initialize the ELIZA/ETH pool with 0.3% fee
3. Add initial liquidity

**Checkpoint**: ✅ ELIZA/ETH pool initialized (manual verification required)

---

## Phase 3: Game Contracts

**Duration**: 30-45 minutes
**Gas Required**: ~1-2 ETH

### Step 3.1: Deploy Hyperscape Contracts

```bash
echo "📝 Deploying Hyperscape MUD Contracts..."

cd apps/hyperscape

# Set environment
export WORLD_ADDRESS=""
export RPC_HTTP_URL=$JEJU_RPC_URL

# Deploy MUD world
bunx mud deploy --rpcUrl $JEJU_RPC_URL --privateKey $PRIVATE_KEY

# Extract WORLD_ADDRESS from output
WORLD_ADDRESS=$(grep "World deployed at:" deploy.log | awk '{print $4}')

echo "Hyperscape World: $WORLD_ADDRESS"

# Save to .env
echo "WORLD_ADDRESS=$WORLD_ADDRESS" >> .env
```

**Checkpoint**: ✅ Hyperscape contracts deployed

---

### Step 3.2: Deploy Caliguland Contracts

```bash
echo "📝 Deploying Caliguland Contracts..."

cd apps/caliguland

# Deploy prediction market contracts
forge create \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY \
    --broadcast \
    src/PredictionMarket.sol:PredictionMarket

PREDICTION_MARKET=$(forge script script/GetLastDeployment.s.sol --sig "run()" | grep "Deployed to:" | awk '{print $3}')

echo "Prediction Market: $PREDICTION_MARKET"
```

**Checkpoint**: ✅ Caliguland contracts deployed

---

## Phase 4: Verification & Testing

**Duration**: 30-45 minutes

### Step 4.1: Verify Contracts on Block Explorer

```bash
echo "📝 Verifying contracts on block explorer..."

# Verify elizaOS Token
forge verify-contract \
    --chain-id 420690 \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    --compiler-version 0.8.26 \
    $ELIZA_TOKEN \
    src/token/ElizaOSToken.sol:ElizaOSToken \
    --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER)

# Verify PoolManager
forge verify-contract \
    --chain-id 420690 \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    --compiler-version 0.8.26 \
    --use 0.8.26 \
    $POOL_MANAGER \
    lib/v4-core/src/PoolManager.sol:PoolManager \
    --constructor-args $(cast abi-encode "constructor(address)" $DEPLOYER)

# Verify Credit Purchase Contract
forge verify-contract \
    --chain-id 420690 \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    --compiler-version 0.8.26 \
    $CREDIT_CONTRACT \
    src/cloud/CreditPurchaseContract.sol:CreditPurchaseContract \
    --constructor-args $(cast abi-encode "constructor(address,address,address)" $ELIZA_TOKEN $ORACLE_ADDRESS $TREASURY_ADDRESS)

echo "✅ Contracts verified on block explorer"
```

---

### Step 4.2: Run Integration Tests

```bash
echo "🧪 Running integration tests..."

# Test V4 deployment
export JEJU_RPC_URL=https://testnet-rpc.jeju.network
export JEJU_NETWORK=testnet

bun test tests/e2e/uniswap-v4-integration.test.ts

# Expected: All tests passing
```

---

### Step 4.3: Manual Smoke Tests

**Test 1: Purchase Credits**

```bash
# Test credit purchase with ETH
cast send $CREDIT_CONTRACT \
    "purchaseCredits(address,uint256,uint256,address)" \
    "0x0000000000000000000000000000000000000000" \
    1000000000000000000 \
    0 \
    $DEPLOYER \
    --value 0.01ether \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY

# Check credit balance
cast call $ELIZA_TOKEN \
    "balanceOf(address)(uint256)" \
    $DEPLOYER \
    --rpc-url $JEJU_RPC_URL
```

**Test 2: Read PoolManager**

```bash
# Get PoolManager owner
cast call $POOL_MANAGER \
    "owner()(address)" \
    --rpc-url $JEJU_RPC_URL

# Get tick spacing
cast call $POOL_MANAGER \
    "MAX_TICK_SPACING()(int24)" \
    --rpc-url $JEJU_RPC_URL
```

**Checkpoint**: ✅ All smoke tests passing

---

## Phase 5: Frontend Integration

**Duration**: 15-30 minutes

### Step 5.1: Update Frontend Constants

Edit `apps/launchpad/packages/constants/src/index.ts`:

```typescript
export const UNISWAP_V4_ADDRESSES: Record<EvmChainIds, EvmAddressLike> = {
  [EvmChainIds.JejuTestnet]: getAddress("0x..."), // PoolManager
};

export const ELIZA_TOKEN_ADDRESSES: Partial<Record<EvmChainIds, EvmAddressLike>> = {
  [EvmChainIds.JejuTestnet]: getAddress("0x..."), // elizaOS Token
};

export const CREDIT_PURCHASE_ADDRESSES: Partial<Record<EvmChainIds, EvmAddressLike>> = {
  [EvmChainIds.JejuTestnet]: getAddress("0x..."), // CreditPurchaseContract
};
```

### Step 5.2: Test Frontend

```bash
# Start frontend with testnet config
cd apps/launchpad
export NEXT_PUBLIC_CHAIN_ID=420690
export NEXT_PUBLIC_RPC_URL=https://testnet-rpc.jeju.network

npm run dev

# Verify:
# 1. Connect wallet to testnet
# 2. Purchase credits UI works
# 3. Token balances display correctly
# 4. DEX interface loads
```

**Checkpoint**: ✅ Frontend integrated and tested

---

## Post-Deployment

### 1. Update Documentation

- [ ] Update README.md with testnet addresses
- [ ] Update deployment artifacts in `/deployments/`
- [ ] Create deployment summary document
- [ ] Notify team of completion

### 2. Monitoring Setup

```bash
# Set up monitoring for key metrics
# - Contract event logs
# - Transaction success rate
# - Gas prices
# - Error rates

# Example: Monitor CreditsPurchased events
cast logs \
    --address $CREDIT_CONTRACT \
    --from-block latest \
    --rpc-url $JEJU_RPC_URL \
    "CreditsPurchased(address,address,address,uint256,uint256,uint256,uint256)"
```

### 3. Create Deployment Summary

Save to `deployments/testnet-summary-$(date +%Y%m%d).md`:

```markdown
# Testnet Deployment Summary

**Date**: $(date)
**Network**: Jeju Testnet (420690)
**Deployer**: $DEPLOYER

## Deployed Contracts

| Contract | Address | Gas Used |
|----------|---------|----------|
| elizaOS Token | $ELIZA_TOKEN | ... |
| Price Oracle | $ORACLE_ADDRESS | ... |
| Credit Purchase | $CREDIT_CONTRACT | ... |
| PoolManager | $POOL_MANAGER | ... |
| PositionManager | $POSITION_MANAGER | ... |

## Test Results

- ✅ All 321 contract tests passing
- ✅ Integration tests passing
- ✅ Smoke tests completed
- ✅ Frontend verified

## Next Steps

1. Extended testnet testing (1-2 weeks)
2. Monitor for issues
3. Community testing
4. Prepare for mainnet
```

---

## Rollback Procedures

### Emergency Pause

If critical issues are discovered:

```bash
# Pause Credit Purchase Contract
cast send $CREDIT_CONTRACT \
    "pause()" \
    --rpc-url $JEJU_RPC_URL \
    --private-key $PRIVATE_KEY

# Verify paused
cast call $CREDIT_CONTRACT "paused()(bool)" --rpc-url $JEJU_RPC_URL
# Expected: true
```

### Contract Upgrade (if applicable)

```bash
# If using upgradeable proxies:
# 1. Deploy new implementation
# 2. Call upgradeToAndCall on proxy
# 3. Verify new implementation

# If not upgradeable:
# 1. Deploy new version
# 2. Update frontend constants
# 3. Migrate state if needed
```

### Data Recovery

```bash
# Export contract state before changes
cast storage $CONTRACT_ADDRESS --rpc-url $JEJU_RPC_URL > backup-$(date +%s).txt

# Monitor events for state reconstruction
cast logs --address $CONTRACT_ADDRESS --rpc-url $JEJU_RPC_URL > events-backup.txt
```

---

## Troubleshooting

### Issue: Deployment Transaction Fails

**Symptoms**: Transaction reverts or runs out of gas

**Solutions**:
1. Check gas price: `cast gas-price --rpc-url $JEJU_RPC_URL`
2. Increase gas limit: Add `--gas-limit 5000000` to forge commands
3. Check account balance: `cast balance $DEPLOYER --rpc-url $JEJU_RPC_URL`
4. Verify constructor arguments are correct

### Issue: Contract Verification Fails

**Symptoms**: Etherscan verification rejected

**Solutions**:
1. Check compiler version matches: `forge --version`
2. Verify constructor args are correctly encoded
3. Check optimization settings in foundry.toml
4. Try manual verification on block explorer UI

### Issue: Frontend Can't Connect

**Symptoms**: "Network Error" or "Wrong Chain"

**Solutions**:
1. Verify RPC URL in frontend config
2. Check chain ID matches: 420690
3. Verify MetaMask is on testnet
4. Check CORS settings on RPC

### Issue: Tests Failing

**Symptoms**: Integration tests timeout or fail

**Solutions**:
1. Verify contracts deployed correctly
2. Check RPC connectivity
3. Ensure sufficient gas in test account
4. Review test expectations for testnet differences

---

## Emergency Contacts

- **Lead Engineer**: [Your contact]
- **DevOps**: [DevOps contact]
- **Security**: [Security contact]
- **On-Call**: [On-call rotation]

---

## Appendix

### A. Estimated Gas Costs

| Operation | Gas Cost | ETH @ 50 Gwei |
|-----------|----------|---------------|
| Deploy elizaOS Token | ~1.5M | ~0.075 ETH |
| Deploy Oracle | ~1.2M | ~0.06 ETH |
| Deploy Credit Purchase | ~3M | ~0.15 ETH |
| Deploy PoolManager | ~4M | ~0.2 ETH |
| Deploy PositionManager | ~5M | ~0.25 ETH |
| **Total** | **~15M** | **~0.76 ETH** |

### B. Required Accounts

1. **Deployer**: Deploys all contracts
2. **Treasury**: Receives payment funds
3. **Owner**: Admin functions
4. **Testing**: For post-deployment tests

### C. Deployment Timeline

| Phase | Duration | Team Required |
|-------|----------|---------------|
| Pre-deployment | 30 min | 1 engineer |
| Core contracts | 45 min | 1 engineer |
| Uniswap V4 | 60 min | 1 engineer |
| Game contracts | 45 min | 1 engineer |
| Verification | 45 min | 1 engineer |
| Frontend | 30 min | 1 engineer |
| **Total** | **4 hours** | **1-2 engineers** |

---

**End of Runbook**

For questions or issues, contact the engineering team or refer to:
- Technical Documentation: `documentation/developers/`
- Architecture Docs: `documentation/architecture/`
- Security Analysis: `SECURITY_ANALYSIS_FINAL.md`
