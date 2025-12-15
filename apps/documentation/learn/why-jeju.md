# Why Jeju?

> **TL;DR:** Jeju is both an Ethereum L2 and a framework for launching your own appchain. Every Jeju network gets 200ms blocks, gasless transactions, on-chain agent identity (ERC-8004), and cross-chain intents (ERC-7683). All built on OP-Stack.

## Two Things at Once

**Jeju is a network:** A production L2 on Ethereum with all the features below.

**Jeju is a framework:** Fork it, rename it, deploy your own appchain. Every network you launch automatically connects to the Jeju ecosystem with cross-chain identity, shared liquidity, and intent routing.

```bash
# Launch your own Jeju-powered network
jeju fork --name "MyChain" --chain-id 123456
```

[Learn how to fork →](/guides/fork-network)

## Problem

Today's L2s are optimized for humans clicking buttons. They fail for:
- **Autonomous agents** that transact without human approval
- **Applications** that want to sponsor user gas
- **Cross-chain operations** that shouldn't require bridges
- **AI systems** that need to pay for compute on-chain

## Solution

### 1. Gasless by Default

Users never need ETH:

```typescript
import { createWalletClient, http, parseUnits } from 'viem';
import { jejuChain } from '@jejunetwork/config';

const client = createWalletClient({
  chain: jejuChain,
  transport: http('https://rpc.jeju.network'),
});

// User pays gas in USDC instead of ETH
const hash = await client.sendTransaction({
  to: recipient,
  value: amount,
  paymaster: '0x...MULTI_TOKEN_PAYMASTER',
  paymasterInput: encodePaymasterInput({
    token: '0x...USDC_ADDRESS',
    maxAmount: parseUnits('5', 6), // Max 5 USDC for gas
  }),
});
```

Apps can sponsor all user transactions:

```typescript
// Deploy a paymaster that pays for users
const paymaster = await paymasterFactory.createSponsoredPaymaster({
  sponsor: appWalletAddress,
  contracts: [gameContract, marketplaceContract], // Whitelist
});

// Deposit ETH to fund gas
await paymaster.deposit({ value: parseEther('10') });
// Now all calls to whitelisted contracts are free for users
```

### 2. Agent-Native (ERC-8004)

Every agent gets on-chain identity:

```typescript
interface AgentIdentity {
  address: `0x${string}`;
  name: string;
  description: string;
  a2aEndpoint: string;    // Agent-to-Agent protocol
  mcpEndpoint: string;    // Model Context Protocol (for AI)
  metadataUri: string;    // IPFS extended metadata
  trustLabels: string[];  // 'verified', 'trusted', 'partner'
  active: boolean;
}

// Register your agent
await identityRegistry.register({
  name: 'TradingBot',
  description: 'Autonomous market maker',
  a2aEndpoint: 'https://mybot.com/a2a',
  mcpEndpoint: 'https://mybot.com/mcp',
  metadataUri: 'ipfs://Qm...',
});

// Discover other agents
const agents = await indexer.query(`{
  agents(where: { active: true, trustLabels_contains: "verified" }) {
    address name a2aEndpoint
  }
}`);
```

### 3. Intent-Based Cross-Chain (ERC-7683)

Users express what they want, not how:

```typescript
interface Intent {
  sourceChain: number;      // e.g., 42161 (Arbitrum)
  destinationChain: number; // e.g., 420691 (Jeju)
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: number;
  recipient: `0x${string}`;
}

// "I want 100 USDC on Jeju, paying from Arbitrum"
await inputSettler.createIntent({
  sourceChain: 42161,       // Arbitrum
  destinationChain: 420691, // Jeju
  tokenIn: USDC_ARBITRUM,
  tokenOut: USDC_JEJU,
  amountIn: parseUnits('100.05', 6),
  minAmountOut: parseUnits('100', 6),
  deadline: Math.floor(Date.now() / 1000) + 3600,
  recipient: userAddress,
});
// Solvers compete to fill it - no bridges needed
```

### 4. 200ms Confirmation

| Stage | Time | Use Case |
|-------|------|----------|
| Flashblock | 200ms | UI feedback |
| Full Block | 2s | Safe to build on |
| Batch to DA | ~10min | Data recoverable |
| L1 Settlement | ~1hr | Cross-chain proofs |
| Finality | 7 days | L1 withdrawals |

## Comparison

| Feature | Jeju | Base | Arbitrum | Optimism |
|---------|------|------|----------|----------|
| Block Time | 200ms | 2s | 250ms | 2s |
| Native Paymasters | Yes | No | No | No |
| Agent Identity | ERC-8004 | No | No | No |
| Intent Protocol | ERC-7683 | No | No | No |
| A2A/MCP Native | Yes | No | No | No |

## Stack

- **op-reth** — Rust execution client
- **op-node** — Consensus and derivation
- **EigenDA** — Data availability (10x cheaper than calldata)
- **Ethereum** — Settlement and security

Same security as Optimism/Base: fraud proofs, 7-day challenge window.

## Use Cases

**DeFi Agents:** Autonomous trading without human intervention  
**Gasless Games:** Onboard users without ETH requirement  
**AI Inference Markets:** Pay per-request via x402  
**Cross-Chain Apps:** Accept deposits from any chain via intents
