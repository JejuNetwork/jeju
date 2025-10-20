# Jeju Node Operator Staking System (Multi-Token)

Incentivize and reward node operators for running reliable Jeju infrastructure. **Stake ANY token, earn ANY token.**

## Overview

Node operators earn rewards based on:
- **Uptime** (99%+ = higher multiplier)
- **Request volume** (more requests = more rewards)
- **Geographic diversity** (+50% bonus for underserved regions)
- **Response time** (faster = better scores)
- **Token diversity** (+25-50% bonus for minority tokens, V2 feature)

## Multi-Token Features

### What Makes This Different?

1. **Stake ANY registered token** - elizaOS, CLANKER, VIRTUAL, USDC, etc.
2. **Earn rewards in ANY token** - Choose your reward currency
3. **USD-denominated minimums** - Fair across all tokens ($1000 minimum stake)
4. **Paymaster integration** - ETH fees automatically distributed to paymasters
5. **Anti-Sybil protections** - Ownership caps, performance requirements

## Components

### Smart Contract
**Location:** `contracts/src/node-staking/NodeStakingManager.sol`

**Features:**
- Multi-token staking system
- USD-denominated minimums ($1000)
- Performance-based rewards
- Slashing for misbehavior
- Geographic diversity incentives
- V2-ready: Token diversity bonuses, futarchy governance

**Prerequisites:**
- TokenRegistry (all acceptable tokens)
- PaymasterFactory (paymaster per token)
- PriceOracle (USD prices)

### Rewards Oracle
**Location:** `scripts/rewards/rewards-oracle.ts`

**Features:**
- Fetches performance data from node explorer
- Calculates uptime scores
- Submits on-chain updates
- Automated period management

## Deployment

### 1. Deploy Prerequisites

```bash
# Must deploy first:
# - TokenRegistry
# - PaymasterFactory  
# - PriceOracle

export TOKEN_REGISTRY_ADDRESS=0x...
export PAYMASTER_FACTORY_ADDRESS=0x...
export PRICE_ORACLE_ADDRESS=0x...
```

### 2. Deploy Smart Contract

```bash
cd contracts

# Deploy to testnet
forge script script/DeployRewards.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast \
  --verify

# Deploy to mainnet
forge script script/DeployRewards.s.sol \
  --rpc-url https://rpc.jeju.network \
  --broadcast \
  --verify
```

### 3. Fund Contract with ETH

```bash
# Required for paymaster fee distribution
cast send $NODE_STAKING_MANAGER --value 10ether \
  --rpc-url https://rpc.jeju.network \
  --private-key $DEPLOYER_KEY
```

### 4. Start Rewards Oracle

```bash
# Configure
export STAKING_MANAGER=0x...
export ORACLE_PRIVATE_KEY=0x...
export NODE_EXPLORER_API=https://nodes.jeju.network/api

# Run
bun run rewards:oracle

# Or with PM2
pm2 start scripts/rewards/rewards-oracle.ts --name jeju-rewards-oracle

# Or with Docker
docker build -f scripts/rewards/Dockerfile.rewards -t jeju-rewards-oracle .
docker run -d --env-file .env.rewards jeju-rewards-oracle
```

## Economics

### Base Formula (USD-Denominated)

```
Monthly Reward = BaseReward × UptimeMultiplier + VolumeBonus + GeoBonus + DiversityBonus

Where:
  BaseReward = $100 USD/month
  UptimeMultiplier = 0.5x to 2.0x (based on 99%+ uptime)
  VolumeBonus = (Requests / 1000) × $0.01 USD
  GeoBonus = BaseReward × 50% (if underserved region)
  DiversityBonus = BaseReward × 25-50% (if minority token, V2 feature)
```

### Paymaster Economics

```
Reward Paymaster Fee: 5% of rewards (in ETH)
Staking Paymaster Fee: 2% of rewards (in ETH, if different tokens)

Example:
  Operator stakes ELIZA, earns USDC
  Monthly reward: $100 USD
  
  Reward paymaster (USDC): 5% = $5 USD (in ETH)
  Staking paymaster (ELIZA): 2% = $2 USD (in ETH)
  
  Total ETH fees: $7 USD equivalent
```

### Example Calculations

**Scenario 1: Single-Token Staking**
```
Stake: 1000 ELIZA ($1000 USD)
Earn: ELIZA tokens
Uptime: 99.0% (1.0x multiplier)
Requests: 500K/month
Region: North America (not underserved)

Base: $100 USD × 1.0 = $100 USD → 100 ELIZA
Volume: 500 × $0.01 = $5 USD → 5 ELIZA
Geo: $0 USD
Paymaster fee (ELIZA): 5% = $5.25 USD in ETH
Total: 105 ELIZA/month
```

**Scenario 2: Multi-Token Staking**
```
Stake: 1000 USDC ($1000 USD)
Earn: ELIZA tokens
Uptime: 99.8% (1.8x multiplier)
Requests: 2M/month
Region: South America (underserved, +50%)

Base: $100 USD × 1.8 = $180 USD → 180 ELIZA
Volume: 2000 × $0.01 = $20 USD → 20 ELIZA
Geo: $180 × 0.5 = $90 USD → 90 ELIZA
Paymaster fees:
  - ELIZA paymaster: 5% = $14.50 USD in ETH
  - USDC paymaster: 2% = $5.80 USD in ETH
Total: 290 ELIZA/month
```

## For Node Operators

### Registration (Multi-Token)

1. **Approve Staking Token:**
```bash
# Example: Stake ELIZA
cast send $ELIZA_TOKEN "approve(address,uint256)" \
  $STAKING_MANAGER 1000000000000000000000 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY
```

2. **Register Node:**
```bash
# Stake ELIZA, earn USDC (or any combination)
cast send $STAKING_MANAGER \
  "registerNode(address,uint256,address,string,uint8)" \
  $ELIZA_TOKEN \
  1000000000000000000000 \
  $USDC_TOKEN \
  "https://your-rpc.com" \
  3 \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY

# Region codes: 0=NA, 1=SA, 2=EU, 3=AS, 4=AF, 5=OC
```

### Claiming Rewards

```bash
# Check pending rewards (in USD)
cast call $STAKING_MANAGER \
  "calculatePendingRewards(bytes32)" \
  $YOUR_NODE_ID \
  --rpc-url https://rpc.jeju.network

# Claim rewards (converted to your chosen reward token)
cast send $STAKING_MANAGER \
  "claimRewards(bytes32)" \
  $YOUR_NODE_ID \
  --rpc-url https://rpc.jeju.network \
  --private-key $YOUR_PRIVATE_KEY
```

### Monitoring Performance

Visit https://nodes.jeju.network/nodes/YOUR_NODE_ID to track:
- Uptime score
- Request volume
- Response time
- Pending rewards (in USD and reward token)
- Staked value (in USD)

## Configuration Parameters

Can be updated by contract owner:

| Parameter | Current Value | Adjustable |
|-----------|---------------|------------|
| Min Stake | $1000 USD | ✅ Yes (owner) |
| Base Reward | $100 USD/month | ✅ Yes (owner) |
| Uptime Threshold | 99.00% | ✅ Yes (owner) |
| Uptime Min Multiplier | 0.5x | ✅ Yes (owner) |
| Uptime Max Multiplier | 2.0x | ✅ Yes (owner) |
| Geographic Bonus | 50% | ✅ Yes (owner) |
| Volume Bonus Rate | $0.01/1K requests | ✅ Yes (owner) |
| Paymaster Reward Cut | 5% | ✅ Yes (owner) |
| Paymaster Stake Cut | 2% | ✅ Yes (owner) |
| Max Nodes Per Operator | 5 | ✅ Yes (owner) |
| Max Network Ownership | 20% | ✅ Yes (owner) |

## Anti-Sybil Protections

1. **USD Minimum:** $1000 minimum stake (fair across all tokens)
2. **Per-Operator Caps:** Max 5 nodes per operator
3. **Network Ownership Cap:** No operator can control >20% of total stake
4. **Performance Requirements:** Low uptime = lower rewards
5. **Geographic Diversity:** Bonus for underrepresented regions

## Slashing

Operators can be slashed for:
- Extended downtime (>7 days)
- Fraudulent performance reporting
- Network attacks
- Terms of service violations

Slashing percentage determined case-by-case (up to 100% of stake).
Slashed funds go to treasury.

## V2 Features (Planned)

- **Token Diversity Bonus:** +25-50% for minority tokens
- **Futarchy Governance:** Prediction market-based parameter updates
- **Multi-Oracle Consensus:** Require 3+ oracle confirmations
- **Auto-Slashing:** Automated slashing for chronic poor performance

## Support

- **Operator Handbook:** `documentation/operators/node-operator-handbook.md`
- **Discord:** https://discord.gg/jeju (#node-staking)
- **GitHub:** https://github.com/jeju-l3/jeju/issues
