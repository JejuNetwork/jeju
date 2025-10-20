# Architecture Overview

Deep dive into Jeju's technical architecture, design decisions, and how all the pieces fit together.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Ethereum L1 (Final Security Layer)                      │
│ • Validates all state transitions                        │
│ • Provides ultimate finality                             │
│ • 1M+ validators, $50B+ stake                            │
└──────────────┬──────────────────────────────────────────┘
               │ (Validation)
               │
┌──────────────▼──────────────────────────────────────────┐
│ Base (Settlement Layer for Jeju)                      │
│ • Receives Jeju's batches & state roots                  │
│ • Posts its own state to Ethereum                        │
│ • Operated by Coinbase                                   │
│ • FREE RPC access                                        │
└──────────────┬──────────────────────────────────────────┘
               │ (Settlement)
               │
┌──────────────▼──────────────────────────────────────────┐
│ Jeju (Application Layer)                              │
│ • 200ms Flashblocks                                      │
│ • Full EVM compatibility                                 │
│ • Complete DeFi stack                                    │
│ • You operate this!                                      │
└──────────────┬──────────────────────────────────────────┘
               │
               │ (Data Availability - Optional)
               ▼
    ┌──────────────────────┐
    │ EigenDA               │
    │ • 90% cost reduction  │
    │ • Calldata fallback   │
    └──────────────────────┘
```

## Core Components

### 1. Execution Layer (Reth for Production, Geth for Development)

**Purpose**: Execute transactions and manage state

**Technology**: 
- **Production/Testnet**: [Reth](https://github.com/paradigmxyz/reth) (Rust Ethereum) - `op-reth`
- **Localnet**: [Geth](https://github.com/ethereum/go-ethereum) (Go Ethereum) - `geth` and `op-geth`

**Why Different Implementations?**

**Production (Reth)**:
- 3-5x faster than Geth
- Lower memory footprint (8-16GB vs 32GB+)
- Better performance under load
- Modern Rust codebase
- Cost-effective for cloud deployment

**Development (Geth)**:
- Fast startup time (seconds vs minutes)
- Dev mode with instant mining
- Lower resource requirements
- Simple Kurtosis orchestration
- Perfect for local testing

**Deployment Strategy**:
```
Localnet:     Kurtosis → geth (L1) + op-geth (L2)
              Start: bun run dev
              Purpose: Fast local development

Testnet:      Kubernetes → op-reth (sequencer + RPC)
              Deploy: helmfile -e testnet sync
              Purpose: Public testing environment

Mainnet:      Kubernetes → op-reth (sequencer + RPC + archive)
              Deploy: helmfile -e mainnet sync  
              Purpose: Production network
```

**Responsibilities** (same for both):
- Execute EVM transactions
- Manage world state database
- Validate blocks
- Serve JSON-RPC requests
- Maintain transaction pool

### 2. Consensus Layer (OP-Node + Flashblocks)

**Purpose**: Derive L3 blocks from L2 (Base) data

**Technology**: [OP-Node](https://github.com/ethereum-optimism/optimism) with Flashblocks

**How it works**:
1. Monitors Base for batch submissions
2. Derives Jeju blocks from batches
3. Feeds blocks to Reth
4. Provides 200ms sub-block confirmations (Flashblocks)

**Flashblocks**:
- Pre-confirmation in 200ms
- Full confirmation in 2s
- Binding on sequencer
- No security compromise

### 3. Sequencer

**Purpose**: Order transactions and produce blocks

**Components**:
- op-node (consensus)
- reth (execution)
- op-batcher (batching)
- op-proposer (state roots)

**Block Production**:
```
Transaction arrives
    ↓
200ms: Flashblock pre-confirmation
    ↓
2s: Full block inclusion
    ↓
~10min: Batch posted to Base
    ↓
~1hr: State root posted to Base
    ↓
7 days: Challenge period on Base
    ↓
Final: Settlement on Ethereum
```

### 4. Batcher (op-batcher)

**Purpose**: Collect transactions and post to Base

**Flow**:
1. Collect L3 transactions (~100 blocks)
2. Compress data
3. Post to EigenDA (or calldata)
4. Submit commitment to Base

**Optimization**:
- Batch compression (zlib)
- EigenDA for cheap storage
- Automatic calldata fallback
- Cost: $750/month (vs $450k on Ethereum)

### 5. Proposer (op-proposer)

**Purpose**: Post state roots to Base

**Flow**:
1. Every ~1 hour (configurable)
2. Compute state root
3. Post to L2OutputOracle on Base
4. Enables withdrawals after challenge period

**Cost**: Minimal (~$50/month in gas)

### 6. Challenger (op-challenger)

**Purpose**: Monitor for invalid state transitions

**How it works**:
- Watches all proposed state roots
- Recomputes state independently
- If mismatch found, submits fraud proof
- Permissionless - anyone can run

**Security**:
- 7-day challenge window
- Economic incentives for honesty
- Ethereum-level security guarantees

## Data Flow

### User Transaction Journey

```
1. User submits tx to Jeju RPC
   ↓
2. Sequencer validates tx
   • Check signature
   • Check nonce
   • Check balance
   ↓
3. Flashblock pre-confirmation (200ms)
   • Tx included in sub-block
   • Binding commitment from sequencer
   • User gets instant feedback
   ↓
4. Full block inclusion (2s)
   • Tx included in L3 block
   • Executed by Reth
   • State updated
   • Full confirmation
   ↓
5. Batching (~10 minutes)
   • Batcher collects ~100 blocks
   • Compresses transactions
   • Posts to EigenDA
   • Submits commitment to Base
   ↓
6. State root posting (~1 hour)
   • Proposer computes state root
   • Posts to L2OutputOracle on Base
   • Enables withdrawals
   ↓
7. Settlement on Base
   • Base validates batch
   • Base posts to Ethereum
   • Challenge period begins
   ↓
8. Ethereum finality
   • After 7 days on Base
   • After 7 more days on Ethereum
   • Ultimate finality achieved
```

### Withdrawal Flow

```
1. User initiates withdrawal on Jeju
   • Calls L2StandardBridge.withdraw()
   • ETH/tokens burned on L3
   ↓
2. Withdrawal recorded
   • Included in next state root
   • Posted to Base by proposer
   ↓
3. Challenge period (7 days on Base)
   • Anyone can challenge if invalid
   • No challenges = withdrawal valid
   ↓
4. Prove withdrawal on Base
   • User submits proof
   • Proves withdrawal in state root
   ↓
5. Base challenge period (7 days to Ethereum)
   • Base's own challenge window
   ↓
6. Finalize withdrawal
   • User claims funds on Base
   • ETH/tokens released
```

## EigenDA Integration

### What is EigenDA?

**Purpose**: Cheap data availability layer

**Not**: A settlement layer or blockchain

**How it works**:
1. Batcher posts data to EigenDA
2. EigenDA disperses to node operators
3. Operators attest data is available
4. Certificate posted to Base
5. Anyone can retrieve data from EigenDA

### Cost Comparison

```
Posting 1 MB of transaction data:

Ethereum calldata:  $10,000
Ethereum blob:      $100
Base calldata:      $10
EigenDA:            $1

Jeju uses EigenDA = 99.99% savings vs Ethereum!
```

### Fallback Mechanism

```typescript
async function postBatch(batch: Batch) {
  if (eigenDA.available && eigenDA.healthy) {
    // Primary: EigenDA (cheap)
    const cert = await eigenDA.post(batch);
    await base.postCertificate(cert);
  } else {
    // Fallback: Base calldata (expensive but reliable)
    await base.postCalldata(batch);
  }
}
```

**No downtime**: Automatic fallback ensures continuous operation.

## Security Model

### Fraud Proofs

**How they work**:
1. Proposer posts state root
2. Anyone can challenge if invalid
3. Challenger submits fraud proof
4. Contract verifies proof on-chain
5. If valid, proposer slashed

**Requirements**:
- At least 1 honest challenger
- Data availability (guaranteed)
- Valid state transition function (verified by Ethereum)

### Trust Assumptions

**You trust**:
- Ethereum L1 security
- Base security (backed by Ethereum)
- At least 1 honest Jeju challenger

**You don't trust**:
- Jeju sequencer (can be malicious)
- Jeju proposer (can be challenged)
- EigenDA operators (data is verified on Base)

**Result**: Ethereum-level security!

## Performance Characteristics

### Latency

| Milestone | Time | Notes |
|-----------|------|-------|
| Pre-confirmation | 200ms | Flashblock, binding |
| Block inclusion | 2s | Full confirmation |
| Base settlement | 10 min | Batch posted |
| State root | 1 hour | Withdrawal enabled |
| Challenge period | 7 days | Security window |
| Ethereum finality | 14 days | Ultimate security |

### Throughput

| Metric | Value |
|--------|-------|
| **Gas Limit** | 30M gas/block |
| **Block Time** | 2 seconds |
| **Gas/Second** | 15M |
| **TPS (Transfers)** | ~714 tx/sec |
| **TPS (Swaps)** | ~100 tx/sec |

### Costs

| Component | Notes |
|-----------|-------|
| **AWS Infrastructure** | Primary infrastructure costs |
| **Base Settlement** | L1 settlement fees |
| **EigenDA** | Data availability costs |
| **Monitoring** | Observability and alerting |

Significantly lower costs compared to L2 on Ethereum.

## Economic Design

### Fee Structure

```
Total Fee = Execution Fee + L1 Data Fee

Execution Fee:
  = Gas Used × Gas Price
  = Covers sequencer costs

L1 Data Fee:
  = Bytes × Base Gas Price × Scalar
  = Covers Base + EigenDA costs

Total: Very low per transaction
```

### Fee Collection

Fees accumulate in three vaults on Jeju:

```solidity
SequencerFeeVault: 0x4200000000000000000000000000000000000011  // Execution fees
BaseFeeVault:      0x4200000000000000000000000000000000000019  // EIP-1559 base fees
L1FeeVault:        0x420000000000000000000000000000000000001A  // Settlement layer fees
```

Operators withdraw periodically.

### Revenue Model

Transaction fees accumulate in fee vaults and can be withdrawn by operators. The economic model is designed to be sustainable at scale with L3 efficiency advantages.

## Decentralization Roadmap

### Phase 1: Training Wheels (Current)

- Single sequencer (team-operated)
- Permissionless fraud proofs
- Open source code
- Public verification

### Phase 2: Multiple Sequencers (6 months)

- 3-5 sequencers
- Round-robin block production
- Automatic failover
- Sequencer staking

### Phase 3: Decentralized Selection (12 months)

- Permissionless sequencer registration
- Economic incentives for honesty
- Slashing for misbehavior
- MEV mitigation

### Phase 4: Full Decentralization (18 months)

- DAO governance
- Token-based voting
- Permissionless everything
- No central authority

## Comparison with Alternatives

| Feature | Jeju | L2 on ETH | Alt L1 | Sidechain |
|---------|---------|-----------|--------|-----------|
| **Security** | Ethereum | Ethereum | Own validators | Own validators |
| **Costs** | Very Low | High | Varies | Low |
| **Finality** | 2s* | 12s | Varies | Instant* |
| **EVM** | ✅ | ✅ | Sometimes | ✅ |
| **Decentralized** | Future | Yes | Yes | No |

*With fraud proof challenge period for security

## Next Steps

- [**What is Jeju**](/getting-started/what-is-jeju) - Simplified explanation
- [**Deploy Your Chain**](/deployment/overview) - Launch your own
- [**Developer Guide**](/developers/quick-start) - Start building
- [**Network Info**](/network/testnet) - Connect to networks

