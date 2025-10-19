# Introduction to Jeju

Jeju is a Layer 3 blockchain built on the OP-Stack, settling on Base. It provides fast block times and low costs while maintaining Ethereum security.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Ethereum L1                                              │
│ - Final security layer                                   │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│ Base                                                  │
│ - Settlement layer for Jeju                              │
│ - Validates fault proofs                                 │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│ Jeju                                                  │
│ - 200ms Flashblocks                                      │
│ - Full EVM compatibility                                 │
│ - Pre-deployed DeFi protocols                            │
└──────────────────────────────────────────────────────────┘
               │
               │ (Data Availability)
               ▼
    ┌──────────────────────┐
    │ EigenDA               │
    │ - Fallback: calldata  │
    └──────────────────────┘
```

## Key Features

### ⚡ Flashblocks (200ms sub-blocks)
Fast transaction confirmation without waiting for full blocks. Useful for gaming, DeFi, and interactive applications.

### 🔒 Ethereum Security
Inherits Ethereum security through Base's fraud proofs and Ethereum finality.

### 📦 EigenDA Integration
Transaction data stored on EigenDA with automatic fallback to calldata.

## Technical Stack

- **Execution Layer**: [Reth](https://github.com/paradigmxyz/reth) (Rust Ethereum)
- **Consensus Layer**: [OP-Node](https://github.com/ethereum-optimism/optimism) with Flashblocks
- **Settlement**: [Base](https://base.org) (Optimism on Ethereum)
- **Data Availability**: [EigenDA](https://www.eigenlayer.xyz/eigenda) with calldata fallback
- **Monitoring**: Prometheus + Grafana
- **Infrastructure**: Kubernetes on AWS EKS

## Security Model

1. **Sequencer** (Jeju): Produces blocks, posts batches to Base
2. **Base**: Validates state transitions, posts to Ethereum
3. **Ethereum**: Ultimate finality and security
4. **Fault Proofs**: Permissionless - anyone can challenge invalid states
5. **Challenge Period**: 7 days on Base, 7 days Base→Ethereum = 14 days total

## Use Cases

- **DeFi Applications**: Low fees and fast finality
- **Gaming**: 200ms sub-blocks for responsive gameplay
- **NFT Marketplaces**: Fast confirmations
- **Social Networks**: High throughput
- **Payment Apps**: Fast and cheap transactions

## Next Steps

1. [**What is Jeju?**](./what-is-jeju) - Deep dive into the technology
2. [**Quick Start**](./quick-start) - Run a local node
3. [**Installation**](./installation) - Set up your development environment

Or jump to:
- [**Developer Quick Start**](/developers/quick-start) - Deploy your first contract
- [**Network Information**](/network/testnet) - Connect to testnet or mainnet
- [**Deploy Your Chain**](/deployment/overview) - Launch your own instance
