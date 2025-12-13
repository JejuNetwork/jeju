---
layout: home

hero:
  name: Jeju
  text: The L2 Built for Agents
  tagline: 200ms blocks. Gasless transactions. Native agent infrastructure. Built on OP-Stack.
  image:
    src: /logo.svg
    alt: Jeju
  actions:
    - theme: brand
      text: Get Started →
      link: /build/quick-start
    - theme: alt
      text: Why Jeju?
      link: /learn/why-jeju

features:
  - icon: 
      src: /icons/flash.svg
      alt: Fast
    title: 200ms Flashblocks
    details: Pre-confirmation in 200ms, finality in 2 seconds. The fastest L2 experience.
    link: /learn/architecture
    linkText: Learn more
  
  - icon:
      src: /icons/gas.svg
      alt: Gasless
    title: Pay Gas in Any Token
    details: ERC-4337 paymasters let users pay in USDC, JEJU, or any registered token. No ETH required.
    link: /learn/gasless
    linkText: Learn more
  
  - icon:
      src: /icons/agent.svg
      alt: Agents
    title: Agent-First Infrastructure
    details: ERC-8004 identity, A2A protocol, and MCP integration. Purpose-built for autonomous agents.
    link: /learn/agents
    linkText: Learn more
  
  - icon:
      src: /icons/intent.svg
      alt: Intents
    title: Cross-Chain Intents
    details: ERC-7683 compatible. Express intent on any chain, solvers fulfill on Jeju instantly.
    link: /learn/intents
    linkText: Learn more
---

<script setup>
import { VPTeamMembers } from 'vitepress/theme'
</script>

## Start Building in 60 Seconds

```bash
# Clone and start
git clone https://github.com/elizaos/jeju && cd jeju
bun install && bun run dev

# Your L2 is now running at http://localhost:9545
```

::: tip Ready to deploy?
Skip local setup and deploy directly to [Jeju Testnet →](/build/networks)
:::

## Choose Your Path

<div class="paths">

### 👤 Users
Bridge assets, swap tokens, stake for rewards.

[Open Gateway →](https://gateway.jeju.network)

### 👩‍💻 Developers
Build apps, deploy contracts, integrate APIs.

[Quick Start →](/build/quick-start)

### 🖥️ Operators
Run nodes, provide liquidity, earn rewards.

[Run a Node →](/operate/overview)

</div>

## Network Status

| Network | Chain ID | RPC | Status |
|---------|----------|-----|--------|
| Mainnet | `420691` | `https://rpc.jeju.network` | 🟢 Live |
| Testnet | `420690` | `https://testnet-rpc.jeju.network` | 🟢 Live |

[View full network details →](/build/networks)

## The Stack

```
┌─────────────────────────────────────────────────────────────┐
│  Applications                                                │
│  Gateway · Bazaar · Compute · Storage · Crucible · Indexer   │
├─────────────────────────────────────────────────────────────┤
│  Smart Contracts                                             │
│  Tokens · Identity · Paymasters · OIF · EIL · DeFi           │
├─────────────────────────────────────────────────────────────┤
│  Jeju L2 (OP-Stack)                                          │
│  op-reth + op-node · 200ms Flashblocks                       │
├─────────────────────────────────────────────────────────────┤
│  Data Availability: EigenDA                                  │
├─────────────────────────────────────────────────────────────┤
│  Settlement: Ethereum Mainnet                                │
└─────────────────────────────────────────────────────────────┘
```

[Explore architecture →](/learn/architecture)

<style>
.paths {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  margin: 2rem 0;
}

.paths h3 {
  margin-top: 0;
}

@media (max-width: 768px) {
  .paths {
    grid-template-columns: 1fr;
  }
}
</style>
