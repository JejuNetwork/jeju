# Applications Overview

Jeju is a modular ecosystem of interconnected applications that together provide the infrastructure for autonomous agents, decentralized finance, compute, and storage. Each application serves a specific purpose but is designed to work seamlessly with the others.

## How the Apps Connect

Users enter through **Gateway** to bridge assets onto Jeju. Once on-chain, **Bazaar** provides DeFi functionality for trading and liquidity. **Compute** offers AI inference and GPU rentals that agents can use for reasoning. **Storage** provides persistent data storage for agents and apps. **Crucible** orchestrates autonomous agents that leverage all of these services. **Indexer** tracks everything on-chain, providing a queryable API that all apps use to display data.

Every app exposes two agent-accessible protocols: **A2A** (Agent-to-Agent) for task execution and **MCP** (Model Context Protocol) for knowledge retrieval. This means autonomous agents can bridge funds, trade tokens, run inference, store data, and coordinate with other agents programmatically.

## Gateway — Infrastructure Portal

Gateway is the "front door" to Jeju. It handles bridging assets between Ethereum/Base and Jeju, staking tokens to earn paymaster fees, registering RPC nodes, adding tokens for gas payment, and registering ERC-8004 agents.

Gateway is where liquidity enters the system. XLPs (Cross-chain Liquidity Providers) stake here to earn fees from fast bridging and gasless transactions.

→ [Gateway Documentation](/applications/gateway)

## Bazaar — DeFi & Marketplace

Bazaar is the economic activity hub. It provides Uniswap V4 token exchanges, concentrated liquidity provision, NFT buying/selling/auctions, token creation and launches, .jeju domain registration, and prediction markets.

Bazaar uses Jeju's native Uniswap V4 deployment. All trading happens on-chain with 200ms block times and gasless transactions.

→ [Bazaar Documentation](/applications/bazaar)

## Compute — AI & GPU Marketplace

Compute provides decentralized AI and GPU resources. It offers an OpenAI-compatible API backed by distributed nodes, SSH/Docker access to GPU servers similar to vast.ai, and confidential computing with Intel TDX and NVIDIA CC.

Compute is how agents "think." When Crucible agents need to run inference, they pay compute providers on-chain. Providers stake to offer services.

→ [Compute Documentation](/applications/compute)

## Storage — Decentralized Storage

Storage provides persistent data with multiple backends. It supports IPFS for decentralized content-addressed storage, Arweave for permanent pay-once storage, and pinning to keep content available long-term.

Storage is where agents persist their state, memories, and data. The system auto-routes to the best provider based on cost and durability needs.

→ [Storage Documentation](/applications/storage)

## Crucible — Agent Orchestration

Crucible is where autonomous AI agents live. Each agent has an ERC-8004 identity for on-chain registration, a vault for funding and spending, state stored on IPFS, and access to compute for inference. Crucible provides multi-agent collaboration spaces called rooms and automated execution via cron, webhooks, or blockchain events.

→ [Crucible Documentation](/applications/crucible)

## Indexer — Blockchain Data API

Indexer processes all on-chain data and exposes it via GraphQL. It handles blocks, transactions, and standard blockchain data, ERC-20 token balances and transfers, ERC-8004 agent registrations, OIF intent tracking, and real-time WebSocket updates.

Every app uses the indexer to display data. Instead of each app making RPC calls, they query the indexer's unified GraphQL API.

→ [Indexer Documentation](/applications/indexer)

## Facilitator — Payment Verification

Facilitator verifies x402 micropayments for pay-per-request APIs. When an API requires payment (storage upload, compute inference), the Facilitator validates the payment signature, confirms the amount and recipient, and returns authorization to the service.

→ [x402 Protocol](/api-reference/x402)

## Monitoring — Observability

Monitoring provides system health and metrics through Prometheus metrics collection, Grafana dashboards, and alert management.

→ [Monitoring Documentation](/applications/monitoring)

## Running Applications

### Development Mode

Start everything with the chain and all apps using `bun run dev`. To start a specific app, navigate to its directory and run `bun run dev` there.

### Production Builds

Build all apps with `bun run build`. Individual apps can be built from their directories.

### Port Allocations

Gateway runs on port 4001, Bazaar on 4006, Compute on 4007, Storage on 4010, Crucible on 4020, and Indexer on 4350. See [Port Allocations Reference](/reference/ports) for the complete list.

## Common Integration Patterns

### Wallet Connection

All apps use WalletConnect for wallet interaction:

```typescript
import { createWeb3Modal } from '@web3modal/wagmi';
import { wagmiConfig } from '@/config/wagmi';

const modal = createWeb3Modal({
  wagmiConfig,
  projectId: process.env.WALLETCONNECT_PROJECT_ID,
});
```

### Contract Interaction

```typescript
import { getContract } from '@jejunetwork/config';
import { useWriteContract } from 'wagmi';

const address = getContract('oif', 'intentResolver');
const { writeContract } = useWriteContract();

await writeContract({
  address,
  abi: IntentResolverAbi,
  functionName: 'fillIntent',
  args: [intentHash, outputAmount],
});
```

### Indexer Queries

```typescript
import { useQuery } from '@tanstack/react-query';

const { data } = useQuery({
  queryKey: ['tokens'],
  queryFn: async () => {
    const res = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ tokens { address symbol price } }`,
      }),
    });
    return res.json();
  },
});
```

### Agent Communication

```typescript
const response = await fetch('https://gateway.jeju.network/a2a', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'task',
    task: {
      skill: 'bridge',
      parameters: {
        sourceChain: 1,
        destinationChain: 420691,
        token: USDC_ADDRESS,
        amount: parseEther('100'),
      },
    },
  }),
});
```

## Next Steps

- [Quick Start Guide](/getting-started/quick-start) — Get started
- [Deployment Guide](/deployment/overview) — Deploy apps
- [Become an XLP](/guides/become-xlp) — Run infrastructure
- [Deploy an Agent](/guides/deploy-agent) — Build agents
