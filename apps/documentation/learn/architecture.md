# Architecture

How Jeju's components work together.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATIONS                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Gateway │ │ Bazaar  │ │ Compute │ │ Storage │ │Crucible │        │
│  │  :4001  │ │  :4006  │ │  :4007  │ │  :4010  │ │  :4020  │        │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │
│       │           │           │           │           │              │
│       └───────────┴───────────┼───────────┴───────────┘              │
│                               │                                      │
│                    ┌──────────▼──────────┐                           │
│                    │      Indexer        │                           │
│                    │   GraphQL :4350     │                           │
│                    └──────────┬──────────┘                           │
├───────────────────────────────┼──────────────────────────────────────┤
│                     SMART CONTRACTS                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Tokens  │ │Identity │ │Paymaster│ │   OIF   │ │   EIL   │        │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
├───────────────────────────────┼──────────────────────────────────────┤
│                         JEJU L2                                      │
│           ┌───────────────────┼───────────────────┐                  │
│           │                   │                   │                  │
│      ┌────▼────┐        ┌─────▼─────┐       ┌─────▼─────┐            │
│      │ op-reth │◄──────►│  op-node  │       │op-batcher │            │
│      │  :9545  │        │           │       │           │            │
│      └─────────┘        └───────────┘       └─────┬─────┘            │
│                                                   │                  │
├───────────────────────────────────────────────────┼──────────────────┤
│                    DATA AVAILABILITY              │                  │
│                    ┌──────────────────────────────▼─┐                │
│                    │           EigenDA              │                │
│                    │    (Ethereum calldata fallback)│                │
│                    └────────────────────────────────┘                │
├──────────────────────────────────────────────────────────────────────┤
│                         ETHEREUM L1                                  │
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│      │L1 Contracts │  │ State Roots │  │ Fraud Proofs│               │
│      └─────────────┘  └─────────────┘  └─────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

## OP-Stack Components

### Execution Layer

**op-reth** is the execution client:
- Processes transactions
- Maintains state
- Exposes JSON-RPC API at port 9545
- Uses Reth (Rust) for performance

### Consensus Layer

**op-node** derives L2 state:
- Watches L1 for deposits and batches
- Builds L2 blocks
- Communicates with op-reth via Engine API

### Batch Submission

**op-batcher** handles data availability:
- Collects L2 transactions
- Compresses into batches
- Posts to EigenDA (primary) or Ethereum calldata (fallback)

### State Proposals

**op-proposer** posts state roots:
- Periodically posts L2 state root to L1
- Enables withdrawals after challenge period
- ~1 hour cadence

### Fraud Proofs

**op-challenger** monitors for fraud:
- Watches proposed state roots
- Submits fraud proofs if invalid
- 7-day challenge window

## Block Production

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Flashblock  │────►│  Full Block  │────►│    Batch     │
│    200ms     │     │      2s      │     │    ~10min    │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  Settlement  │◄────│   EigenDA    │
                     │     ~1hr     │     │              │
                     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Finality   │
                     │    7 days    │
                     └──────────────┘
```

### Flashblocks (200ms)
Pre-confirmation from sequencer. Safe for UI feedback but not guaranteed.

### Full Blocks (2s)
Included in canonical chain. Safe to build on.

### Batches (~10min)
Posted to data availability layer. Recoverable by any node.

### Settlement (~1hr)
State root posted to Ethereum. Cross-chain proofs available.

### Finality (7 days)
Challenge period complete. Withdrawals to L1 execute.

## Application Architecture

### Gateway
Primary user entry point:
- Bridge UI for deposits/withdrawals
- Staking interface for XLPs
- Token registration for paymasters
- Node registration for operators

### Bazaar
DeFi and marketplace hub:
- Uniswap V4 integration
- NFT marketplace
- Token launchpad
- JNS name service

### Compute
AI inference marketplace:
- OpenAI-compatible API
- Provider registration
- Session-based rentals
- x402 micropayments

### Storage
Decentralized storage:
- IPFS integration
- Arweave for permanence
- Pin management
- Agent memory storage

### Crucible
Agent orchestration:
- Agent lifecycle management
- Multi-agent rooms
- Trigger system (cron, events)
- Vault management

### Indexer
Blockchain data API:
- GraphQL endpoint
- Real-time subscriptions
- Event processing
- Cross-service queries

## Data Flow

### User Transaction

```
1. User signs transaction
2. Submitted to op-reth RPC
3. Included in next block (2s)
4. Indexed by Indexer
5. Available via GraphQL
6. Apps update UI
```

### Intent Execution

```
1. User creates intent on source chain
2. Intent indexed (Indexer watches all chains)
3. Solver sees profitable intent
4. Solver fills on Jeju (OutputSettler)
5. Oracle confirms source chain state
6. Solver claims from InputSettler
```

### Gasless Transaction

```
1. User builds UserOperation
2. UserOp includes paymaster data
3. Bundler submits to EntryPoint
4. EntryPoint calls paymaster.validatePaymasterUserOp()
5. Paymaster verifies token balance / sponsorship
6. Transaction executes
7. Paymaster receives tokens / deducts from deposit
```

### Agent Communication

```
1. Agent A queries IdentityRegistry
2. Gets Agent B's A2A endpoint
3. Sends task to B's /a2a endpoint
4. B executes (may call Compute, Storage)
5. B returns result
6. Optional: Payment via x402
```

## Fee Structure

### Execution Fee
```
execution_fee = gas_used × gas_price
```
Paid to sequencer. ~0.001 gwei on Jeju.

### L1 Data Fee
```
l1_data_fee = calldata_bytes × l1_gas_price × scalar
```
Covers settlement costs. Reduced 10x with EigenDA.

### Total Fee
```
total_fee = execution_fee + l1_data_fee
```
Typically < $0.001 per transaction.

## Security Model

### Trust Assumptions
1. **Ethereum security** — L1 is secure
2. **One honest challenger** — Someone will submit fraud proofs
3. **Data availability** — EigenDA or L1 calldata available
4. **Sequencer liveness** — Centralized but can be forced via L1

### Withdrawal Security
- Standard withdrawals: 7-day challenge period
- Fast withdrawals: Via XLP liquidity (instant, requires trust in XLP)

### Contract Security
- Multi-sig ownership on production
- OpenZeppelin UUPS upgrades
- Audited before mainnet
- Bug bounty program

## Network Configuration

| Parameter | Localnet | Testnet | Mainnet |
|-----------|----------|---------|---------|
| Chain ID | 1337 | 420690 | 420691 |
| Block Time | 2s | 2s | 2s |
| Flashblocks | 200ms | 200ms | 200ms |
| L1 | Local Geth | Sepolia | Ethereum |

## Next Steps

- [Quick Start](/build/quick-start) — Run locally
- [Core Concepts](/learn/concepts) — Deep dive on primitives
- [Deploy to Testnet](/build/networks) — Go live

