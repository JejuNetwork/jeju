---
layout: home

hero:
  name: Jeju
  text: L2 on Ethereum
  tagline: OP-Stack with 200ms Flashblocks, ERC-4337 paymasters, and ERC-8004 agent identity.
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
    details: Flashblocks for instant confirmation. Full blocks every 2 seconds.
  
  - icon: 💸
    title: Pay Gas in Any Token
    details: ERC-4337 paymasters let users pay gas in JEJU, elizaOS, USDC, or any registered token.
  
  - icon: 🤖
    title: Agent-First
    details: ERC-8004 identity, A2A protocol, MCP integration. Built for autonomous agents.
  
  - icon: 🔗
    title: Cross-Chain Intents
    details: ERC-7683 compatible. Send intents from any chain, solvers fulfill on Jeju.
---

## Quick Start

```bash
git clone https://github.com/elizaos/jeju.git && cd jeju
bun install
bun run dev
```

Prerequisites: Docker, Kurtosis, Bun, and Foundry. See [Quick Start](/getting-started/quick-start) for installation.

## Networks

**Localnet** runs on chain ID 1337 at `http://127.0.0.1:9545`. **Testnet** runs on chain ID 420690 at `https://testnet-rpc.jeju.network`. **Mainnet** runs on chain ID 420691 at `https://rpc.jeju.network`.

## Core Applications

[Gateway](/applications/gateway) on port 4001 handles bridging, paymasters, staking, and node registration. [Bazaar](/applications/bazaar) on port 4006 provides DeFi via Uniswap V4, NFTs, token launchpad, and JNS names. [Compute](/applications/compute) on port 4007 offers decentralized AI inference. [Storage](/applications/storage) on port 4010 provides IPFS/Arweave storage. [Crucible](/applications/crucible) on port 4020 handles agent orchestration, vaults, and multi-agent rooms. [Indexer](/applications/indexer) on port 4350 exposes a GraphQL blockchain data API.

## Key Features

The [Paymaster System](/contracts/payments) enables paying gas in any registered token via ERC-4337. The [Cross-Chain Bridge (EIL)](/contracts/eil) provides trustless transfers via XLP liquidity providers. [Open Intents (OIF)](/contracts/oif) implements ERC-7683 cross-chain intents. [Agent Identity (ERC-8004)](/contracts/identity) provides on-chain identity for apps and agents. The [Name Service (JNS)](/contracts/jns) offers human-readable names like `myagent.jeju`.

## Test Account

The primary test account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` with private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` is pre-funded with 10,000 ETH on localnet.
