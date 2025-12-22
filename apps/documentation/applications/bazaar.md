# Bazaar

Unified DeFi hub with token swaps, liquidity pools, NFT marketplace, launchpad, JNS domains, and prediction markets.

## Overview

Bazaar is Jeju's all-in-one DeFi application built on Uniswap V4. It provides:

- **Token Swap** - Swap any registered token with optimal routing
- **Liquidity Pools** - Provide liquidity and earn fees
- **NFT Marketplace** - Buy, sell, and mint NFTs
- **Launchpad** - Launch tokens with bonding curves or presales
- **JNS** - Register and manage .jeju domains
- **OTC Trading** - Peer-to-peer token trades
- **Prediction Markets** - Create and trade on outcomes

All transactions can be gasless using Jeju's multi-token paymaster.

## Quick Start

```bash
cd apps/bazaar
bun install
bun run dev
```

Bazaar runs on http://localhost:4006

## Features

### Token Swap

Swap tokens using Uniswap V4's singleton architecture with hooks for custom logic:

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({ network: 'mainnet', privateKey });

await jeju.defi.swap({
  tokenIn: 'USDC',
  tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
  slippage: 0.5, // 0.5%
});
```

### Liquidity Pools

Provide liquidity to earn swap fees:

```typescript
await jeju.defi.addLiquidity({
  tokenA: 'JEJU',
  tokenB: 'USDC',
  amountA: parseEther('1000'),
  amountB: parseUnits('1000', 6),
});
```

### NFT Marketplace

Browse, buy, and sell NFTs with support for:
- ERC-721 and ERC-1155
- Royalty enforcement
- Batch listings
- Auction and fixed-price sales

### Launchpad

Launch tokens with different mechanisms:

**Bonding Curve** - Continuous price discovery
```typescript
await jeju.launchpad.createBondingCurve({
  name: 'My Token',
  symbol: 'MTK',
  initialPrice: parseEther('0.001'),
  curveType: 'linear',
});
```

**Presale** - Fixed-price with vesting
```typescript
await jeju.launchpad.createPresale({
  token: tokenAddress,
  price: parseUnits('0.1', 6), // 0.1 USDC
  hardCap: parseUnits('100000', 6),
  vestingDuration: 30 * 24 * 60 * 60, // 30 days
});
```

### JNS (Jeju Name Service)

Register human-readable names:

```typescript
await jeju.names.register({
  name: 'alice',
  duration: 365 * 24 * 60 * 60, // 1 year
});

const address = await jeju.names.resolve('alice.jeju');
```

### OTC Trading

Create peer-to-peer trades:

```typescript
await jeju.otc.createOffer({
  tokenIn: 'JEJU',
  tokenOut: 'USDC',
  amountIn: parseEther('10000'),
  amountOut: parseUnits('5000', 6),
  expiry: Date.now() + 24 * 60 * 60 * 1000,
});
```

## Environment Variables

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_RPC_URL=https://rpc.jejunetwork.org
NEXT_PUBLIC_INDEXER_URL=https://indexer.jejunetwork.org/graphql
NEXT_PUBLIC_POOL_MANAGER=0x...
```

## Development

```bash
bun run dev      # Development server
bun run build    # Production build
bun run test     # All tests
bun run test:e2e # E2E tests
```

## Related

- [SDK DeFi Module](/build/sdk/defi) - DeFi SDK integration
- [DeFi Contracts](/contracts/defi) - Smart contract reference
- [Gasless Transactions](/learn/gasless) - How paymasters work

---

<details>
<summary>📋 Copy as Context</summary>

```
Bazaar - Unified DeFi Hub

Features:
1. Token Swap - Uniswap V4 with optimal routing
2. Liquidity Pools - Provide LP, earn fees
3. NFT Marketplace - ERC-721/1155, auctions, fixed-price
4. Launchpad - Bonding curves, presales
5. JNS - .jeju domain registration
6. OTC Trading - Peer-to-peer trades
7. Prediction Markets - Outcome trading

All transactions can be gasless via multi-token paymaster.

SDK Examples:

// Swap
await jeju.defi.swap({
  tokenIn: 'USDC', tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
});

// Add Liquidity
await jeju.defi.addLiquidity({
  tokenA: 'JEJU', tokenB: 'USDC',
  amountA: parseEther('1000'),
  amountB: parseUnits('1000', 6),
});

// Register JNS name
await jeju.names.register({ name: 'alice', duration: 365*24*60*60 });

Setup:
cd apps/bazaar
bun install
bun run dev
# Runs on http://localhost:4006
```

</details>
