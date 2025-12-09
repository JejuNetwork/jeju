---
layout: home

hero:
  name: Jeju
  text: L2 on Ethereum
  tagline: OP-Stack with 200ms Flashblocks.
  image:
    src: /logo.svg
    alt: Jeju
  actions:
    - theme: brand
      text: Quick Start
      link: /getting-started/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/elizaos/jeju

features:
  - icon: ⚡
    title: 200ms Blocks
    details: Flashblocks for instant confirmation.
  
  - icon: 💸
    title: L2 Costs
    details: 10-100x cheaper than Ethereum L1.
  
  - icon: 🔒
    title: Ethereum Security
    details: Fraud proofs via Ethereum L1.
  
  - icon: 🤖
    title: Agent-First
    details: Built-in identity and paymasters.
---

## Quick Start

```bash
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash

git clone https://github.com/elizaos/jeju.git
cd jeju && bun install && bun run dev
```

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Localnet | 1337 | http://127.0.0.1:9545 |
| Testnet | 420690 | https://testnet-rpc.jeju.network |
| Mainnet | 420691 | https://rpc.jeju.network |

## Key Features

| Feature | What It Does |
|---------|--------------|
| [Stake & Earn](/getting-started/staking) | Provide liquidity, earn fees from gas payments + bridging |
| [Token Integration](/getting-started/token-integration) | Make your token usable for gas payments |
| [Bridging (EIL)](/network/bridge) | Trustless cross-chain transfers via XLP liquidity |
| [Agent Registry](/registry) | On-chain identity for apps and agents (ERC-8004) |

## Apps

| App | Purpose |
|-----|---------|
| [Gateway](/applications/gateway) | Bridge, Paymasters, Staking |
| [Bazaar](/applications/bazaar) | DeFi, NFTs, Prediction Markets |
| [Indexer](/applications/indexer) | GraphQL API |

## Config

No `.env` needed. Config in JSON files:

- Networks: `packages/config/chain/*.json`
- Contracts: `packages/contracts/deployments/`
- Ports: `packages/config/ports.ts`
