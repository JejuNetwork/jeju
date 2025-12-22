---
layout: home

hero:
  name: Jeju
  text: OP-Stack L2 for Agents
  tagline: 200ms blocks, gasless transactions, on-chain agent identity
  image:
    src: /logo.svg
    alt: Jeju
  actions:
    - theme: brand
      text: Quick Start →
      link: /getting-started/quick-start
    - theme: alt
      text: Architecture
      link: /learn/architecture

features:
  - icon: ⚡
    title: 200ms Blocks
    details: Pre-confirmation in 200ms, finality in 2 seconds.
    link: /learn/architecture
  
  - icon: 🎫
    title: Gasless Transactions
    details: Pay fees in USDC, JEJU, or any token. Or sponsor gas for your users.
    link: /learn/gasless
  
  - icon: 🤖
    title: Agent Identity
    details: On-chain registry for AI agents with A2A messaging and MCP endpoints.
    link: /learn/agents
  
  - icon: 🌉
    title: Cross-Chain
    details: Bridge from Ethereum or Base in seconds via liquidity providers.
    link: /integrate/overview
---

## What is Jeju?

Jeju is an Ethereum L2 built on OP-Stack with EigenDA. It provides:

- **Fast blocks** — 200ms pre-confirmation
- **Gasless UX** — Users don't need ETH
- **Agent infrastructure** — On-chain identity and messaging for AI agents
- **Cross-chain bridging** — Liquidity providers enable instant transfers

## Quick Start

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

L2 runs at `http://localhost:9545`. Gateway UI at `http://localhost:4001`.

## Who This Documentation Is For

### Using the Apps

If you want to use Jeju's applications:

| App | What it does | Link |
|-----|--------------|------|
| **Gateway** | Bridge assets, stake JEJU, register tokens | [Gateway →](/applications/gateway) |
| **Bazaar** | DEX, NFT marketplace, token launches | [Bazaar →](/applications/bazaar) |
| **Wallet** | Browser extension wallet | [Wallet →](/applications/wallet) |

### Building DApps

If you're building applications on Jeju:

```bash
bun add @jejunetwork/sdk viem
```

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Swap tokens
await jeju.defi.swap({ tokenIn: 'USDC', tokenOut: 'JEJU', amountIn: parseUnits('100', 6) });

// Bridge from Base
await jeju.crosschain.transfer({ from: 'base', to: 'jeju', token: 'ETH', amount: parseEther('1') });
```

→ [Build Overview](/build/overview) | [SDK Reference](/packages/sdk)

### Running Infrastructure

If you want to run nodes or provide liquidity:

| Role | What you do | Requirements |
|------|-------------|--------------|
| **RPC Node** | Serve RPC requests | 0.5 ETH stake |
| **Compute Node** | AI inference | GPU, 1 ETH stake |
| **Storage Node** | IPFS pinning | 10TB+, 0.5 ETH stake |
| **XLP** | Bridge liquidity | Capital + 1 ETH stake |
| **Solver** | Fill intents | Capital + 0.5 ETH stake |

→ [Operate Overview](/operate/overview)

### Contributing to Jeju

If you're working on the Jeju codebase:

```
jeju/
├── apps/           # Applications (gateway, bazaar, crucible, etc.)
├── packages/
│   ├── sdk/        # TypeScript SDK
│   ├── contracts/  # Solidity contracts
│   ├── cli/        # Development CLI
│   ├── oauth3/     # Decentralized auth
│   └── ...
└── scripts/        # Deployment scripts
```

→ [CLI Reference](/packages/cli) | [Contracts](/packages/contracts)

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Mainnet | `420691` | `https://rpc.jejunetwork.org` |
| Testnet | `420690` | `https://testnet-rpc.jejunetwork.org` |
| Localnet | `1337` | `http://127.0.0.1:9545` |

## Applications

| App | Port | Description |
|-----|------|-------------|
| Gateway | 4001 | Bridge, staking, token registry |
| Bazaar | 4006 | DEX, NFTs, launchpad |
| DWS | 4007 | Compute + Storage + CDN |
| Crucible | 4020 | Agent orchestration |
| Indexer | 4350 | GraphQL API |
| Factory | 4008 | Developer tools |

## Test Account

Pre-funded with 10,000 ETH on localnet:

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju - Ethereum L2 (OP-Stack + EigenDA)

Networks:
- Mainnet: 420691, https://rpc.jejunetwork.org
- Testnet: 420690, https://testnet-rpc.jejunetwork.org
- Localnet: 1337, http://127.0.0.1:9545

Quick Start:
git clone https://github.com/elizaos/jeju && cd jeju
bun install && bun run dev

SDK:
bun add @jejunetwork/sdk viem
import { createJejuClient } from '@jejunetwork/sdk';
const jeju = await createJejuClient({ network: 'testnet', privateKey: '0x...' });

Core features:
- 200ms blocks (Flashblocks)
- Gasless: pay in any token or sponsor gas
- Agent identity (ERC-8004)
- Cross-chain bridging (EIL + OIF)

Apps: Gateway (4001), Bazaar (4006), DWS (4007), Crucible (4020), Indexer (4350)

Test account (localnet):
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

</details>
