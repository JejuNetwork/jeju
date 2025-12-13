# Why Jeju?

Jeju is an L2 purpose-built for autonomous agents and next-generation applications. Here's why it matters.

## The Problem

Today's L2s are optimized for DeFi and NFTs. They work for humans clicking buttons in wallets. But they fail for:

- **Autonomous agents** that need to transact without human approval
- **Applications** that want to sponsor user gas costs
- **Cross-chain operations** that shouldn't require bridges
- **AI systems** that need to pay for compute on-chain

## Jeju's Solution

### 1. Gasless by Default

Users don't need ETH. Ever.

```typescript
// User pays gas in USDC
const tx = await wallet.sendTransaction({
  to: recipient,
  value: amount,
  paymaster: MULTI_TOKEN_PAYMASTER,
  paymasterToken: USDC_ADDRESS,
});
```

Apps can sponsor all user transactions:

```typescript
// App pays for users
const paymaster = await factory.createSponsoredPaymaster({
  sponsor: appWallet,
  contracts: [gameContract, marketplaceContract],
});
```

### 2. Agent-Native

Every application and AI agent gets an on-chain identity (ERC-8004):

```typescript
// Register your agent
await identityRegistry.register({
  name: "TradingBot",
  description: "Autonomous market maker",
  a2aEndpoint: "https://mybot.com/a2a",
  mcpEndpoint: "https://mybot.com/mcp",
});
```

Agents discover each other on-chain and communicate via standard protocols (A2A, MCP).

### 3. Intent-Based Cross-Chain

Users express what they want, not how to get it:

```typescript
// "I want 100 USDC on Jeju, paying from my Arbitrum wallet"
await inputSettler.createIntent({
  sourceChain: ARBITRUM,
  destinationChain: JEJU,
  tokenIn: USDC_ARBITRUM,
  tokenOut: USDC_JEJU,
  amountIn: parseUnits("100", 6),
});

// Solvers compete to fill it
```

No bridges. No wrapped tokens. Just outcomes.

### 4. 200ms Confirmation

Flashblocks provide pre-confirmation in 200ms. Final confirmation in 2 seconds.

| Stage | Time |
|-------|------|
| Flashblock (pre-confirm) | 200ms |
| Full Block (finality) | 2s |
| Batch to DA | ~10min |
| L1 Settlement | ~1hr |

Fast enough for real-time applications.

## Comparison

| Feature | Jeju | Base | Arbitrum | Optimism |
|---------|------|------|----------|----------|
| Block Time | 200ms | 2s | 250ms | 2s |
| Native Paymasters | ✅ | ❌ | ❌ | ❌ |
| Agent Identity | ✅ ERC-8004 | ❌ | ❌ | ❌ |
| Intent Protocol | ✅ ERC-7683 | ❌ | ❌ | ❌ |
| A2A/MCP Native | ✅ | ❌ | ❌ | ❌ |

## Built On OP-Stack

Jeju uses the battle-tested OP-Stack:

- **op-reth** — Rust execution client (fast, memory-efficient)
- **op-node** — Consensus and block derivation
- **EigenDA** — Data availability (cheaper than calldata)
- **Ethereum** — Settlement and security

Same security model as Optimism and Base. 7-day fraud proof window.

## Use Cases

### DeFi Agents
Autonomous trading bots that execute strategies without human intervention. Pay compute costs on-chain. Report via A2A.

### Gasless Games
Onboard users without requiring ETH. Sponsor all in-game transactions. Settle assets on L2.

### AI Inference Markets
Providers stake to offer compute. Users pay per-request via x402. Settlement is trustless and instant.

### Cross-Chain Applications
Accept deposits from any chain. Let solvers handle bridging. Users never touch a bridge UI.

## Get Started

Ready to build?

- [Quick Start](/build/quick-start) — Run locally in 60 seconds
- [Tutorials](/tutorials/overview) — Build real applications
- [Deploy to Testnet](/build/networks) — Go live

## Learn More

- [Core Concepts](/learn/concepts) — Understand the primitives
- [Architecture](/learn/architecture) — How the stack works
- [FAQ](/faq) — Common questions

