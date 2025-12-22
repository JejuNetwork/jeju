# Architecture

Jeju is an OP-Stack L2 on Ethereum with EigenDA for data availability.

## Stack Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Applications                                                │
│  Gateway · Bazaar · Crucible · Factory · DWS · Indexer       │
├─────────────────────────────────────────────────────────────┤
│  Smart Contracts                                             │
│  Tokens · Identity · Paymasters · OIF · EIL · DeFi           │
├─────────────────────────────────────────────────────────────┤
│  Jeju L2 (OP-Stack)                                          │
│  op-reth + op-node · 200ms Flashblocks · ERC-4337 Bundler    │
├─────────────────────────────────────────────────────────────┤
│  Data Availability: EigenDA (Ethereum calldata fallback)     │
├─────────────────────────────────────────────────────────────┤
│  Settlement: Ethereum Mainnet                                │
└─────────────────────────────────────────────────────────────┘
```

## OP-Stack Components

| Component | Description |
|-----------|-------------|
| **op-reth** | Execution client (Rust Ethereum) |
| **op-node** | Consensus client, derives chain from L1 |
| **op-batcher** | Batches L2 transactions to L1/EigenDA |
| **op-proposer** | Posts L2 state roots to L1 |
| **op-challenger** | Monitors for fraud (future) |

## Block Times

| Stage | Time |
|-------|------|
| Flashblock pre-confirmation | 200ms |
| L2 block finality | 2s |
| L1 confirmation | ~15 min |
| Challenge period | 7 days |

## Transaction Flow

1. **User submits** transaction (or UserOperation)
2. **Sequencer** includes in block (200ms pre-confirmation)
3. **Block finalized** on L2 (2 seconds)
4. **Batcher** posts to EigenDA (every minute)
5. **Proposer** posts state root to L1 (every hour)
6. **Settlement** finalized on Ethereum (7 day window)

```
User ──▶ Sequencer ──▶ L2 Block ──▶ Batcher ──▶ EigenDA ──▶ L1 State Root
         (200ms)       (2s)        (1 min)     (1 min)      (1 hour)
```

## Flashblocks

Flashblocks provide 200ms pre-confirmation:

1. User submits transaction
2. Sequencer immediately pre-confirms
3. Transaction guaranteed in next block
4. Block finalized at 2s boundary

This enables UX comparable to centralized systems.

## Fee Structure

| Fee Type | Amount |
|----------|--------|
| L2 Execution | ~0.001 gwei |
| L1 Data Fee | Variable (EigenDA reduces cost) |
| Priority Fee | Optional tip to sequencer |

Fees can be paid in:
- ETH (native)
- USDC, JEJU, or any registered token (via paymaster)

## Account Abstraction

Jeju has native ERC-4337 support:

| Component | Description |
|-----------|-------------|
| **EntryPoint** | Standard ERC-4337 EntryPoint |
| **Bundler** | Native bundler in op-reth |
| **Paymasters** | Multi-token and sponsored |

Smart accounts enable:
- Social recovery
- Multi-sig
- Spending limits
- Session keys

## Key Protocols

### ERC-8004 (Agent Identity)

On-chain registry for applications and AI agents:

- Unique identities with metadata
- A2A (agent-to-agent) endpoints
- MCP (Model Context Protocol) endpoints
- Reputation and validation

### ERC-4337 (Account Abstraction)

Smart contract wallets with:

- Gasless transactions (paymasters)
- Multi-token gas payment
- Batched transactions

### ERC-7683 (Open Intents Framework)

Cross-chain intent system:

- User expresses intent on source chain
- Solvers compete to fulfill
- Oracle verifies execution

### EIL (Ethereum Interop Layer)

Instant cross-chain transfers:

- XLPs front liquidity
- Users receive instantly
- No bridge wait time

## Data Availability

### EigenDA

Primary DA layer with:

- Lower costs than calldata
- High throughput
- Ethereum economic security

### Fallback

If EigenDA is unavailable:

- Automatic fallback to Ethereum calldata
- Higher cost but always available
- Transparent to users

## Security Model

| Layer | Security |
|-------|----------|
| L2 Execution | Sequencer (currently centralized) |
| State Transition | Fault proofs (7 day challenge) |
| Data Availability | EigenDA + Ethereum |
| Settlement | Ethereum mainnet |

### Decentralization Roadmap

1. ✅ Launch with centralized sequencer
2. 🔄 Shared sequencer integration
3. 🔜 Decentralized sequencer set
4. 🔜 Permissionless block production

## Interoperability

### Cross-Chain Communication

| Protocol | Purpose |
|----------|---------|
| Hyperlane | Message passing, token bridging |
| EIL | Instant token transfers |
| OIF | Cross-chain intents |
| Optimism Portal | Native L1↔L2 messaging |

### Supported Chains

| Chain | Support Level |
|-------|--------------|
| Ethereum | Full (settlement) |
| Base | OIF + EIL |
| Arbitrum | Coming soon |
| Solana | ZK Bridge |

## Related

- [Quick Start](/getting-started/quick-start) - Get started
- [Gasless Transactions](/learn/gasless) - How paymasters work
- [Agent Concepts](/learn/agents) - ERC-8004 and agents
- [Cross-chain](/integrate/overview) - EIL and OIF

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Architecture

Stack:
- Applications: Gateway, Bazaar, Crucible, Factory, DWS, Indexer
- Smart Contracts: Tokens, Identity, Paymasters, OIF, EIL, DeFi
- L2: OP-Stack (op-reth + op-node), 200ms Flashblocks
- DA: EigenDA (Ethereum calldata fallback)
- Settlement: Ethereum Mainnet

OP-Stack Components:
- op-reth: Execution client
- op-node: Consensus, derives from L1
- op-batcher: Batches to L1/EigenDA
- op-proposer: Posts state roots
- op-challenger: Fraud monitoring

Block Times:
- Flashblock: 200ms pre-confirmation
- L2 finality: 2 seconds
- L1 confirmation: ~15 min
- Challenge period: 7 days

Key Protocols:
- ERC-8004: Agent identity
- ERC-4337: Account abstraction
- ERC-7683: Cross-chain intents
- EIL: Instant bridging

Fee payment: ETH, USDC, JEJU, any registered token

Cross-chain: Hyperlane, EIL, OIF, Optimism Portal
Supported chains: Ethereum, Base, Arbitrum (soon), Solana (ZK)
```

</details>
