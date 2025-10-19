# Uniswap V4 Testnet Deployment Checklist

Complete checklist for deploying Uniswap V4 on Jeju Testnet.

## Overview

- **Network**: Jeju Testnet (Chain ID: 420690)
- **Settlement**: Base Sepolia (Chain ID: 84532)
- **Cost**: Minimal (testnet gas fees only)
- **Time**: 15-30 minutes
- **Difficulty**: Beginner to Intermediate

## What is Uniswap V4?

Uniswap V4 represents a major evolution in decentralized exchange architecture:

- **Singleton Architecture**: One PoolManager contract manages all liquidity pools (gas efficient)
- **Hooks System**: Custom logic at 8 different lifecycle points
- **Flash Accounting**: Transient storage (EIP-1153) for significantly lower gas costs
- **Native ETH**: No WETH wrapping required for ETH trades
- **Custom Curves**: Support for custom AMM implementations

Unlike V2/V3 which deploy separate contracts for each pool, V4 uses a single PoolManager contract, reducing deployment costs and enabling powerful composability through hooks.

---

## Prerequisites

### Required Accounts & Access

- [ ] Jeju Testnet RPC access (https://testnet-rpc.jeju.network)
- [ ] Deployer account with testnet ETH (minimum 0.5 ETH)
- [ ] Private key for deployment account
- [ ] (Optional) Block explorer access for verification

### Required Tools

- [ ] Bun runtime installed (`curl -fsSL https://bun.sh/install | bash`)
- [ ] Foundry (forge) installed and updated (`curl -L https://foundry.paradigm.xyz | bash`)
- [ ] Git configured
- [ ] Text editor for reviewing deployment output

### Required Knowledge

- [ ] Basic understanding of Uniswap V4 architecture
- [ ] Familiarity with command line operations
- [ ] Understanding of Ethereum addresses and private keys

---

## Phase 1: Environment Setup

### Step 1.1: Verify Prerequisites

```bash
# Verify Bun is installed
bun --version
# Should show v1.0.0 or higher

# Verify Foundry is installed
forge --version
# Should show forge 0.2.0 or higher

# Verify git
git --version
```

- [ ] Bun installed
- [ ] Foundry installed
- [ ] Git installed

### Step 1.2: Clone/Update Repository

```bash
# If not already in the repository
cd /path/to/jeju

# Pull latest changes
git pull origin main

# Update submodules (includes Uniswap V4 contracts)
git submodule update --init --recursive

# Verify v4-core is present
ls contracts/lib/v4-core
# Should show Uniswap V4 contracts
```

- [ ] Repository up to date
- [ ] Submodules initialized
- [ ] v4-core directory exists

### Step 1.3: Generate Deployment Account

If you don't have a testnet deployment account:

```bash
# Generate new account
cast wallet new

# Output will show:
# Successfully created new keypair.
# Address:     0x...
# Private key: 0x...

# Save the private key securely!
# For testnet, you can store in a local file (NOT for mainnet!)
echo "0xYOUR_PRIVATE_KEY" > .testnet-deployer-key
chmod 600 .testnet-deployer-key
```

- [ ] Deployment account created
- [ ] Private key saved securely
- [ ] Address recorded

### Step 1.4: Fund Deployment Account

You need testnet ETH on Jeju Testnet:

**Option A: Bridge from Base Sepolia**

```bash
# First, get Base Sepolia ETH from faucet:
# https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

# Then use Jeju testnet bridge to bridge to L3
# https://testnet-bridge.jeju.network

# Send at least 0.5 ETH for deployment
```

**Option B: Use Testnet Faucet (if available)**

```bash
# Check Jeju testnet faucet
# https://testnet-faucet.jeju.network

# Request 1 ETH for your deployment address
```

**Verify Balance:**

```bash
# Set your address
export DEPLOYER_ADDRESS="0xYOUR_ADDRESS"

# Check balance on Jeju Testnet
cast balance $DEPLOYER_ADDRESS \
  --rpc-url https://testnet-rpc.jeju.network

# Should show at least 500000000000000000 (0.5 ETH)
```

- [ ] Deployment account funded with 0.5+ ETH
- [ ] Balance verified on Jeju Testnet

---

## Phase 2: Pre-Deployment Verification

### Step 2.1: Verify Network Connectivity

```bash
# Test RPC connection
cast block latest --rpc-url https://testnet-rpc.jeju.network

# Should show latest block information
# Chain ID should be 420690

# Get chain ID to confirm
cast chain-id --rpc-url https://testnet-rpc.jeju.network
# Should return: 420690
```

- [ ] RPC endpoint accessible
- [ ] Chain ID correct (420690)
- [ ] Latest block returns successfully

### Step 2.2: Verify Foundry Setup

```bash
cd contracts

# Install dependencies
forge install

# Build contracts (includes v4-core)
forge build --use 0.8.26

# Should compile successfully with no errors
```

- [ ] Dependencies installed
- [ ] Contracts compile successfully
- [ ] No compilation errors

### Step 2.3: Check Existing Deployment

```bash
# Check if already deployed
ls contracts/deployments/uniswap-v4-420690.json

# If exists, review existing deployment
cat contracts/deployments/uniswap-v4-420690.json
```

If a deployment already exists:
- [ ] Review existing deployment address
- [ ] Decide if redeployment is needed
- [ ] Backup existing deployment file if redeploying

---

## Phase 3: Deployment

### Step 3.1: Set Environment Variables

```bash
cd /path/to/jeju

# Set private key
export PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
# Or read from file:
export PRIVATE_KEY=$(cat .testnet-deployer-key)

# Set network
export JEJU_NETWORK="testnet"

# (Optional) Set custom RPC URL
export JEJU_RPC_URL="https://testnet-rpc.jeju.network"

# Verify variables are set
echo "Network: $JEJU_NETWORK"
echo "Deployer: $(cast wallet address --private-key $PRIVATE_KEY)"
```

- [ ] PRIVATE_KEY set
- [ ] JEJU_NETWORK set to "testnet"
- [ ] Variables verified

### Step 3.2: Run Deployment Script

```bash
# Deploy Uniswap V4
bun run scripts/deploy-uniswap-v4.ts

# The script will:
# 1. Validate your private key
# 2. Connect to Jeju Testnet RPC
# 3. Check deployer balance (min 0.5 ETH)
# 4. Deploy PoolManager contract
# 5. Verify deployment
# 6. Save deployment info
# 7. Print next steps

# Expected output:
# ======================================================================
# Deploying Uniswap V4 to Jeju
# ======================================================================
#
# Network: testnet
# RPC URL: https://testnet-rpc.jeju.network
# ...
# ✅ PoolManager deployed: 0x...
# ✅ Deployment verified successfully!
# 📝 Deployment saved: contracts/deployments/uniswap-v4-420690.json
```

**Expected Duration**: 2-5 minutes

- [ ] Deployment started
- [ ] No errors during deployment
- [ ] PoolManager address received
- [ ] Deployment file saved

### Step 3.3: Save Deployment Information

The script automatically saves deployment info, but record it manually too:

```bash
# View deployment info
cat contracts/deployments/uniswap-v4-420690.json

# Record these values:
# - PoolManager address
# - Deployer address
# - Timestamp
```

**Record Here:**
- PoolManager Address: `0x_______________________________________________`
- Deployer Address: `0x_______________________________________________`
- Deployment Date: `____________________`

- [ ] Deployment info saved
- [ ] Addresses recorded
- [ ] Backup created

---

## Phase 4: Post-Deployment Verification

### Step 4.1: Run Verification Script

```bash
# Verify deployment
bun run scripts/verify-uniswap-v4-deployment.ts --network testnet

# Expected output:
# ======================================================================
# Verifying Uniswap V4 Deployment
# ======================================================================
#
# ✅ Deployment file found
# ✅ Deployment information valid
# ✅ RPC connection verified
# ✅ PoolManager contract deployed
# ✅ PoolManager functions working
# ✅ WETH address correct
#
# Tests Passed: 6/6
# ✅ All verification checks passed!

# For detailed output:
bun run scripts/verify-uniswap-v4-deployment.ts --network testnet --verbose
```

- [ ] Verification script runs successfully
- [ ] All checks pass (6/6)
- [ ] No errors reported

### Step 4.2: Manual Contract Verification

```bash
# Get PoolManager address from deployment
export POOL_MANAGER=$(cat contracts/deployments/uniswap-v4-420690.json | grep poolManager | cut -d'"' -f4)

echo "PoolManager: $POOL_MANAGER"

# Check contract code exists
cast code $POOL_MANAGER --rpc-url https://testnet-rpc.jeju.network
# Should return long hex string (contract bytecode)

# Check owner
cast call $POOL_MANAGER "owner()" --rpc-url https://testnet-rpc.jeju.network
# Should return your deployer address

# Check tick spacing constants
cast call $POOL_MANAGER "MAX_TICK_SPACING()" --rpc-url https://testnet-rpc.jeju.network
# Should return a number (max tick spacing)

cast call $POOL_MANAGER "MIN_TICK_SPACING()" --rpc-url https://testnet-rpc.jeju.network
# Should return a number (min tick spacing)
```

- [ ] Contract bytecode exists
- [ ] Owner is correct
- [ ] Constants are readable
- [ ] No RPC errors

### Step 4.3: Verify on Block Explorer (Optional)

If Jeju Testnet has a block explorer:

```bash
# Open in browser
echo "https://testnet-explorer.jeju.network/address/$POOL_MANAGER"

# Check:
# - Contract code is present
# - Contract creation transaction exists
# - Deployer address matches your account
```

- [ ] Contract visible on explorer
- [ ] Creation transaction confirmed
- [ ] Details match deployment

---

## Phase 5: Integration & Next Steps

### Step 5.1: Update Configuration Files

If you have applications that need the PoolManager address:

```bash
# Example: Update your app config
# contracts/src/constants.ts or similar

export const UNISWAP_V4_POOL_MANAGER = {
  testnet: "0xYOUR_POOL_MANAGER_ADDRESS",
  // ... other networks
};
```

- [ ] Application configs updated
- [ ] Address added to constants
- [ ] Git committed (if appropriate)

### Step 5.2: Test Basic Functionality

You can test the PoolManager is working:

```bash
# Create a simple test script or use cast directly

# Example: Try to initialize a pool (will fail without tokens, but should execute)
# This is just to test the contract is callable

cast send $POOL_MANAGER "owner()" \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY

# Check transaction succeeded
```

- [ ] Contract is callable
- [ ] Transactions execute
- [ ] Gas costs reasonable

### Step 5.3: Plan Hook Deployments (Optional)

If you want to use Uniswap V4 hooks:

```bash
# Hooks provide custom logic at these points:
# - beforeInitialize / afterInitialize
# - beforeModifyPosition / afterModifyPosition
# - beforeSwap / afterSwap
# - beforeDonate / afterDonate

# Example hooks to consider:
# 1. Dynamic fee hooks (adjust fees based on volatility)
# 2. TWAMM hooks (time-weighted average market maker)
# 3. Limit order hooks
# 4. Oracle hooks (price feeds)

# See Uniswap V4 documentation:
# https://docs.uniswap.org/contracts/v4/guides/hooks/
```

- [ ] Hook requirements identified
- [ ] Hook contracts reviewed
- [ ] Deployment plan created

---

## Phase 6: Documentation & Handoff

### Step 6.1: Document Deployment

Create a deployment record:

```markdown
# Uniswap V4 Testnet Deployment - [DATE]

## Deployment Details
- Network: Jeju Testnet
- Chain ID: 420690
- PoolManager: 0x...
- Deployer: 0x...
- Deployed At: [ISO timestamp]

## Verification
- Deployment script: ✅ Passed
- Verification script: ✅ Passed (6/6 checks)
- Block explorer: ✅ Verified

## Next Steps
- [ ] Deploy hooks (if needed)
- [ ] Initialize test pools
- [ ] Integrate with application
```

- [ ] Deployment documented
- [ ] Details recorded
- [ ] Team notified

### Step 6.2: Share with Team

```bash
# Commit deployment file to repository
git add contracts/deployments/uniswap-v4-420690.json
git commit -m "Deploy Uniswap V4 to testnet"
git push

# Share deployment address with team via:
# - Discord/Slack channel
# - GitHub issue/PR
# - Team documentation
```

- [ ] Deployment file committed
- [ ] Team notified
- [ ] Documentation updated

---

## Troubleshooting

### Issue: "Insufficient balance" Error

**Symptoms**: Deployment fails with balance error

**Solution**:
```bash
# Check balance
cast balance $DEPLOYER_ADDRESS --rpc-url https://testnet-rpc.jeju.network

# If low, get more testnet ETH:
# 1. Use Base Sepolia faucet
# 2. Bridge to Jeju Testnet
# 3. Retry deployment
```

### Issue: "Failed to connect to RPC" Error

**Symptoms**: Cannot connect to RPC endpoint

**Solution**:
```bash
# Test RPC manually
curl -X POST https://testnet-rpc.jeju.network \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# Should return: {"jsonrpc":"2.0","id":1,"result":"0x66a0a"}

# If fails:
# 1. Check internet connection
# 2. Verify RPC URL is correct
# 3. Try alternative RPC endpoint
# 4. Check if testnet is operational
```

### Issue: "Chain ID mismatch" Error

**Symptoms**: Chain ID doesn't match expected value

**Solution**:
```bash
# Verify chain ID
cast chain-id --rpc-url https://testnet-rpc.jeju.network

# Should be: 420690

# If different:
# 1. Verify you're using correct RPC URL
# 2. Check JEJU_NETWORK environment variable
# 3. Confirm testnet configuration
```

### Issue: "Contract deployment failed" Error

**Symptoms**: Forge deployment fails

**Solution**:
```bash
# Check forge version
forge --version

# Update if needed
foundryup

# Rebuild contracts
cd contracts
forge clean
forge build --use 0.8.26

# Retry deployment
```

### Issue: Verification Script Fails

**Symptoms**: Some verification checks fail

**Solution**:
```bash
# Run with verbose output
bun run scripts/verify-uniswap-v4-deployment.ts --network testnet --verbose

# Review specific failures
# Common issues:
# 1. RPC timeout - retry
# 2. Contract not yet propagated - wait 30 seconds
# 3. Wrong network - check JEJU_NETWORK variable
```

---

## Common Questions

### Q: Do I need to deploy anything besides PoolManager?

**A**: No! Uniswap V4 uses a singleton architecture. PoolManager is the only core contract needed. Hooks are optional and deployed separately if needed.

### Q: Can I use the same PoolManager for multiple pools?

**A**: Yes! That's the point of V4's singleton architecture. All pools are managed by the same PoolManager contract.

### Q: How do I create a pool after deployment?

**A**: Call `PoolManager.initialize()` with:
- Token pair addresses (currency0, currency1)
- Fee tier (e.g., 3000 for 0.3%)
- Tick spacing (e.g., 60)
- Hook contract address (or address(0) for no hooks)
- Initial sqrt price

### Q: Do I need WETH?

**A**: No! V4 supports native ETH directly. WETH is still supported for compatibility, but not required.

### Q: What are hooks and do I need them?

**A**: Hooks are optional contracts that add custom logic to pools. You don't need them for basic pools. They're useful for:
- Dynamic fees
- Custom oracles
- Limit orders
- MEV protection
- Custom AMM curves

### Q: Is this deployment production-ready?

**A**: This is a testnet deployment for testing purposes. For mainnet:
- Follow the mainnet checklist
- Complete security audits
- Use hardware wallet for deployment
- Set up monitoring and alerts

---

## Next Steps After Deployment

### For Developers

1. **Test Pool Creation**
   ```bash
   # Create a test pool with your tokens
   # See Uniswap V4 documentation for examples
   ```

2. **Integrate with Application**
   ```typescript
   import { UNISWAP_V4_POOL_MANAGER } from './constants';

   // Use PoolManager in your app
   const poolManager = getContract({
     address: UNISWAP_V4_POOL_MANAGER.testnet,
     abi: PoolManagerABI,
   });
   ```

3. **Test Swaps**
   ```bash
   # Test a swap through your integration
   # Verify gas costs are lower than V3
   ```

### For Testing

1. **Load Testing**
   - Create multiple pools
   - Execute many swaps
   - Test gas efficiency
   - Verify hook behavior

2. **Edge Cases**
   - Test extreme prices
   - Test with low liquidity
   - Test hook failures
   - Test pause/unpause (if implemented)

3. **Integration Testing**
   - Test with your frontend
   - Test with other protocols
   - Test bridge interactions
   - Test token transfers

### For Mainnet Preparation

1. **Security Audit**
   - Audit your hook contracts (if any)
   - Review integration code
   - Test on testnet extensively

2. **Monitoring Setup**
   - Set up contract monitoring
   - Configure alerts
   - Create dashboards

3. **Documentation**
   - Write user guides
   - Document integration
   - Create runbooks

---

## Resources

### Official Documentation
- [Uniswap V4 Overview](https://docs.uniswap.org/contracts/v4/overview)
- [Uniswap V4 Hooks Guide](https://docs.uniswap.org/contracts/v4/guides/hooks/)
- [V4 Core Repository](https://github.com/Uniswap/v4-core)
- [V4 Periphery (Examples)](https://github.com/Uniswap/v4-periphery)

### Jeju Documentation
- [Deployment Overview](./overview)
- [Testnet Deployment](./testnet)
- [Network Configuration](/network/testnet)
- [Developer Quick Start](/developers/quick-start)

### Tools
- [Cast (Foundry)](https://book.getfoundry.sh/reference/cast/)
- [Forge (Foundry)](https://book.getfoundry.sh/reference/forge/)
- [Viem Documentation](https://viem.sh/)

### Support
- Discord: [#dev-support](https://discord.gg/jeju)
- GitHub Issues: [elizaos/jeju](https://github.com/elizaos/jeju/issues)
- Email: dev@jeju.network

---

## Checklist Summary

### Pre-Deployment
- [ ] Environment setup complete
- [ ] Tools installed and verified
- [ ] Deployment account funded
- [ ] Network connectivity confirmed

### Deployment
- [ ] Environment variables set
- [ ] Deployment script executed
- [ ] PoolManager deployed
- [ ] Deployment info saved

### Verification
- [ ] Verification script passed (6/6)
- [ ] Manual verification complete
- [ ] Block explorer checked
- [ ] Addresses recorded

### Post-Deployment
- [ ] Configuration files updated
- [ ] Basic functionality tested
- [ ] Documentation complete
- [ ] Team notified

---

**Deployment Time**: 15-30 minutes
**Gas Requirements**: Minimal testnet gas needed
**Difficulty**: Beginner to Intermediate
**Support**: Available via Discord and GitHub
