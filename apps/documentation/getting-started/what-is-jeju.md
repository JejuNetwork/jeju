# What is Jeju?

Jeju is a Layer 3 blockchain - an application-specific rollup that settles on Base instead of directly on Ethereum L1. This architecture provides the optimal balance of security, performance, and cost.

## Layer 3 Explained

### Traditional L2 Architecture
```
┌─────────────┐
│ Ethereum L1 │ ← L2 posts here (expensive)
└─────────────┘
       ↑
       │ High costs
       │
┌─────────────┐
│  Typical L2 │
└─────────────┘
```

### Jeju's L3 Architecture
```
┌─────────────┐
│ Ethereum L1 │
└─────────────┘
       ↑
       │ Base pays this
       │
┌─────────────┐
│   Base   │ ← You post here (much cheaper)
└─────────────┘
       ↑
       │ Very low cost
       │
┌─────────────┐
│  Jeju    │ ← Your application chain
└─────────────┘
```

## How It Works

### Block Production

1. **Sequencer** produces blocks every 2 seconds
2. **Flashblocks** provides 200ms sub-block confirmations
3. **Batcher** collects transactions and creates batches
4. **Batches** posted to EigenDA (cheap storage)
5. **Certificates** posted to Base (proves data availability)
6. **Proposer** posts state roots to Base every hour
7. **Base** validates and posts to Ethereum

### Data Flow

```
User Transaction
    ↓
Jeju Sequencer (200ms pre-confirmation)
    ↓
Jeju Block (2s full confirmation)
    ↓
op-batcher (collects ~100 blocks)
    ↓
EigenDA (stores full data)
    ↓
Base (validates + DA certificate)
    ↓
Ethereum L1 (ultimate finality)
```

### Security Guarantees

Even though Jeju is an L3, it inherits **full Ethereum security**:

1. **Fraud Proofs**: Anyone can challenge invalid state transitions
2. **Challenge Period**: 7 days on Base + 7 days on Ethereum
3. **Data Availability**: Guaranteed by EigenDA + calldata fallback
4. **Permissionless**: No trust required in operators
5. **Ethereum Finality**: All state eventually settles to Ethereum

### Why This Works

Base (your settlement layer) is itself secured by Ethereum:
- Base posts fraud proofs to Ethereum
- Base state is validated by Ethereum
- If Base fails, you can still recover (though it's extremely unlikely)

**Therefore**: Jeju → Base → Ethereum = You're secured by Ethereum!

## Technical Components

### Execution Layer: Reth
- Written in Rust for performance
- Fully EVM-compatible
- Handles transaction execution
- Manages state database

### Consensus Layer: OP-Node + Flashblocks
- Derives L3 blocks from L2 batches
- Implements Flashblocks (200ms sub-blocks)
- Handles L2 communication
- Manages block production

### Batcher
- Collects L3 transactions
- Posts to EigenDA (primary)
- Falls back to calldata if needed
- Optimizes batch size for cost

### Proposer
- Posts output roots to Base
- Commits to L3 state
- Enables withdrawals
- Posts every ~1 hour (configurable)

### Challenger
- Monitors for invalid state transitions
- Can dispute proposer's claims
- Permissionless (anyone can run)
- Protects network integrity

## EigenDA Integration

EigenDA is Jeju's **data availability** layer (not settlement):

### What EigenDA Does
- Stores full transaction data cheaply
- Provides attestations that data is available
- 90% cheaper than Ethereum calldata
- Optional but highly recommended

### Fallback Mechanism
```typescript
if (eigenDA.available) {
  // Post to EigenDA ($300/month)
  const certificate = await eigenDA.post(batch);
  await base.postCertificate(certificate);
} else {
  // Fallback to Base calldata ($7,500/month)
  await base.postCalldata(batch);
}
```

**No downtime!** The system automatically falls back to calldata if EigenDA is unavailable.

## Flashblocks Technology

Flashblocks provides **200ms pre-confirmations** without waiting for full blocks:

### How It Works
1. Transaction submitted to sequencer
2. Sequencer validates and signs (200ms)
3. User receives pre-confirmation
4. Transaction included in next full block (2s)
5. Full confirmation achieved

### Use Cases
- **Gaming**: Responsive gameplay without lag
- **Trading**: Instant order confirmations
- **NFTs**: Immediate mint confirmations
- **Payments**: Real-time transaction feedback

### Safety
- Pre-confirmations are binding on sequencer
- Reorg protection through economic incentives
- Full security after block inclusion
- No compromise on L1 security

## Network Parameters

### Jeju Testnet
- **Chain ID**: 420690
- **Block Time**: 2 seconds
- **Sub-block Time**: 200ms
- **Settlement**: Base Sepolia (84532)
- **Status**: Live and stable

### Jeju Mainnet
- **Chain ID**: 420691
- **Block Time**: 2 seconds
- **Sub-block Time**: 200ms
- **Settlement**: Base (8453)
- **Status**: Production ready

## DeFi Stack

Jeju comes with pre-deployed DeFi protocols:

### Uniswap V4
- Next-generation AMM
- Custom hooks for advanced features
- Capital efficient concentrated liquidity
- Low gas costs

### Synthetix V3
- Decentralized perpetuals
- Synthetic assets
- On-chain derivatives
- Low latency trading

### Compound V3
- Lending and borrowing
- Isolated pools
- Risk management
- High capital efficiency

### ERC-4337 (Account Abstraction)
- Gasless transactions
- Social recovery
- Batch operations
- Improved UX

## Governance

### Multisig Setup
- **Operations**: 3-of-5 multisig (emergency actions)
- **Upgrades**: 5-of-9 multisig with 48hr timelock
- **Treasury**: Hardware wallets (Ledger) only

### Decentralization Path
1. **Phase 1** (Current): Training wheels - team operates sequencer
2. **Phase 2** (6 months): Multiple sequencers with rotation
3. **Phase 3** (12 months): Decentralized sequencer selection
4. **Phase 4** (18 months): Full decentralization + token governance

## Comparison with Alternatives

### vs. L2 on Ethereum
- ✅ 600x cheaper L1 costs
- ✅ Faster finality (2s vs 12s)
- ✅ Free RPC from Base
- ⚠️ Longer withdrawal time (14d vs 7d)
- ✅ Same security model

### vs. L2 on Other L1s
- ✅ Ethereum security (not alt-L1)
- ✅ Base ecosystem access
- ✅ Proven OP-Stack tech
- ✅ Coinbase support

### vs. Sidechains
- ✅ Full L1 security (not trust-based)
- ✅ Fraud proofs
- ✅ Permissionless validation
- ✅ No additional trust assumptions

### vs. App Chains (Cosmos, etc.)
- ✅ No validator set needed
- ✅ Ethereum security
- ✅ Easier to operate
- ✅ Lower capital requirements

## Economic Model

### Fee Structure
```solidity
Total Fee = Execution Fee + L1 Data Fee

Execution Fee:
  = Gas Used × Gas Price
  = Goes to sequencer
  
L1 Data Fee:
  = Bytes Posted × Base Gas Price
  = Covers Base + EigenDA costs
  = Small (thanks to L3!)
```

### Fee Collection
Fees automatically accumulate in vaults:
- `L2_FEE_VAULT` (execution fees)
- `BASE_FEE_VAULT` (base fees)
- `L1_FEE_VAULT` (L1 data fees)

Operators can withdraw anytime.

### Economic Sustainability

Transaction fees accumulate and can be withdrawn by operators. The L3 architecture provides significant cost advantages, enabling sustainable operations at moderate transaction volumes.

## Monitoring & Operations

### Health Checks
- Block production rate
- Batch submission rate
- State root posting
- Challenge monitoring
- RPC availability
- Data availability (EigenDA + calldata)

### Alerts
- Sequencer down
- Batcher failing
- Proposer stuck
- High gas prices
- Data availability issues

### Runbooks
See [Operations](/deployment/runbooks) for detailed procedures.

## Next Steps

- [**Quick Start**](./quick-start) - Run Jeju locally
- [**Installation**](./installation) - Set up development environment
- [**Developer Guide**](/developers/quick-start) - Build your first dApp
- [**Deploy Your Chain**](/deployment/overview) - Launch your own instance

