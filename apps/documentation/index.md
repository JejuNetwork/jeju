---
layout: home

hero:
  name: Jeju
  text: The L2 Built for Agents
  tagline: 200ms blocks. Gasless transactions. Native agent infrastructure.
  image:
    src: /logo.svg
    alt: Jeju
  actions:
    - theme: brand
      text: Get Started →
      link: /getting-started/quick-start
    - theme: alt
      text: Learn More
      link: /learn/architecture

features:
  - icon: ⚡
    title: 200ms Flashblocks
    details: Pre-confirmation in 200ms, finality in 2 seconds. Faster than any other L2.
    link: /learn/architecture
    linkText: How it works
  
  - icon: 🎫
    title: Pay Gas in Any Token
    details: Users pay fees in USDC, JEJU, or any token. Apps can sponsor gas entirely. No ETH required.
    link: /learn/gasless
    linkText: How it works
  
  - icon: 🤖
    title: Agent Infrastructure
    details: On-chain identity registry, agent-to-agent messaging, and wallet-less authentication for AI agents.
    link: /learn/agents
    linkText: How it works
  
  - icon: 🌉
    title: Instant Cross-Chain
    details: Bridge from Ethereum or Base in seconds, not minutes. Liquidity providers front the funds.
    link: /integrate/overview
    linkText: How it works
---

## What is Jeju?

Jeju is an Ethereum L2 designed for applications that need:
- **Speed** — 200ms pre-confirmation for real-time UX
- **No gas friction** — Users never need to hold ETH
- **Agent support** — First-class infrastructure for AI agents and bots
- **Cross-chain** — Accept payments from any chain instantly

Built on OP-Stack with EigenDA for data availability.

## Start in 60 Seconds

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

L2 running at `http://localhost:9545`. Open Gateway at `http://localhost:4001`.

::: tip Just want to deploy?
Skip local setup. Deploy directly to testnet using the [SDK](/packages/sdk).
:::

## Choose Your Path

| I want to... | Start here |
|--------------|------------|
| **Build a DApp** on Jeju | [Build Overview →](/build/overview) |
| **Bridge assets** to/from Jeju | [Integration Guide →](/integrate/overview) |
| **Run a node** and earn rewards | [Operate →](/operate/overview) |
| **Understand** how Jeju works | [Architecture →](/learn/architecture) |

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Mainnet | `420691` | `https://rpc.jejunetwork.org` |
| Testnet | `420690` | `https://testnet-rpc.jejunetwork.org` |
| Localnet | `1337` | `http://127.0.0.1:9545` |

[Full network details →](/getting-started/networks)

## Quick SDK Example

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'testnet',
  privateKey: '0x...',
});

// Gasless swap — user pays in USDC, not ETH
await jeju.defi.swap({
  tokenIn: 'USDC',
  tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
});

// Instant bridge from Base
await jeju.crosschain.transfer({
  from: 'base',
  to: 'jeju',
  token: 'USDC',
  amount: parseUnits('50', 6),
});
```

[Full SDK documentation →](/packages/sdk)

## The Stack

```
┌─────────────────────────────────────────────────────────────┐
│  Apps: Gateway · Bazaar · Crucible · Factory · DWS          │
├─────────────────────────────────────────────────────────────┤
│  Contracts: Tokens · Identity · Paymasters · Bridge         │
├─────────────────────────────────────────────────────────────┤
│  Jeju L2: OP-Stack (op-reth + op-node)                      │
├─────────────────────────────────────────────────────────────┤
│  Data Availability: EigenDA                                 │
├─────────────────────────────────────────────────────────────┤
│  Settlement: Ethereum Mainnet                                │
└─────────────────────────────────────────────────────────────┘
```

---

<details>
<summary>📋 Copy as Context (for AI assistants)</summary>

```
Jeju - Ethereum L2 for Agents

What it is:
- OP-Stack L2 with 200ms pre-confirmation, 2s finality
- Users pay gas in any token (USDC, JEJU, etc.) or apps sponsor gas
- Built-in agent identity registry and agent-to-agent messaging
- Instant cross-chain via liquidity providers (no bridge wait)

Networks:
- Mainnet: Chain ID 420691, RPC https://rpc.jejunetwork.org
- Testnet: Chain ID 420690, RPC https://testnet-rpc.jejunetwork.org
- Localnet: Chain ID 1337, RPC http://127.0.0.1:9545

Quick Start:
git clone https://github.com/elizaos/jeju && cd jeju
bun install && bun run dev

SDK:
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits } from 'viem';

const jeju = await createJejuClient({ network: 'testnet', privateKey: '0x...' });
await jeju.defi.swap({ tokenIn: 'USDC', tokenOut: 'JEJU', amountIn: parseUnits('100', 6) });
await jeju.crosschain.transfer({ from: 'base', to: 'jeju', token: 'USDC', amount });

Stack: OP-Stack L2 → EigenDA → Ethereum settlement
Apps: Gateway (bridge), Bazaar (DeFi), Crucible (agents), Factory (dev tools), DWS (compute/storage)
```

</details>
