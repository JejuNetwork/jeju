# Indexer

GraphQL API for indexed blockchain data, powered by Subsquid.

## Overview

The Indexer provides a fast GraphQL API for querying Jeju blockchain data:

- **Blocks & Transactions** - Historical and real-time chain data
- **Tokens & Balances** - ERC-20 token tracking
- **Swaps & Liquidity** - DEX activity
- **NFTs** - ERC-721 and ERC-1155 tracking
- **Agents** - ERC-8004 agent registry data
- **Events** - All contract events

## Quick Start

```bash
cd apps/indexer
bun install
bun run db:up  # Start PostgreSQL
bun run dev
```

GraphQL playground: http://localhost:4350/graphql

## Endpoints

| Network | URL |
|---------|-----|
| Mainnet | https://indexer.jejunetwork.org/graphql |
| Testnet | https://testnet-indexer.jejunetwork.org/graphql |
| Localnet | http://127.0.0.1:4350/graphql |

## Example Queries

### Get Recent Blocks

```graphql
query GetBlocks {
  blocks(orderBy: number_DESC, limit: 10) {
    number
    hash
    timestamp
    transactionsCount
  }
}
```

### Get Token Balances

```graphql
query GetBalances($address: String!) {
  tokenBalances(where: { account_eq: $address }) {
    token {
      symbol
      name
      decimals
    }
    balance
  }
}
```

### Get Recent Swaps

```graphql
query GetSwaps {
  swaps(orderBy: timestamp_DESC, limit: 20) {
    id
    tokenIn { symbol }
    tokenOut { symbol }
    amountIn
    amountOut
    sender
    timestamp
  }
}
```

### Get Agent Registry

```graphql
query GetAgents {
  agents(limit: 50) {
    id
    name
    owner
    metadata
    registeredAt
  }
}
```

### Subscriptions

Real-time updates via WebSocket:

```graphql
subscription OnNewSwap {
  swapAdded {
    id
    tokenIn { symbol }
    tokenOut { symbol }
    amountIn
    amountOut
  }
}
```

## Schema Overview

### Core Entities

| Entity | Description |
|--------|-------------|
| `Block` | Block headers and metadata |
| `Transaction` | Transaction details |
| `Token` | ERC-20 token metadata |
| `TokenBalance` | Per-account token balances |
| `Swap` | DEX swap events |
| `LiquidityPosition` | LP positions |
| `NFT` | ERC-721/1155 tokens |
| `Agent` | ERC-8004 agents |
| `Transfer` | Token transfer events |

## Using with SDK

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({ network: 'mainnet' });

// Query via SDK (uses indexer internally)
const tokens = await jeju.defi.getTokens({ limit: 10 });
const swaps = await jeju.defi.getRecentSwaps({ limit: 20 });
```

## Direct GraphQL Client

```typescript
import { GraphQLClient, gql } from 'graphql-request';

const client = new GraphQLClient('https://indexer.jejunetwork.org/graphql');

const query = gql`
  query GetTokens($limit: Int!) {
    tokens(limit: $limit) {
      id
      symbol
      name
      totalSupply
    }
  }
`;

const { tokens } = await client.request(query, { limit: 10 });
```

## Development

```bash
bun run db:up     # Start PostgreSQL
bun run dev       # Start indexer
bun run test      # Run tests
```

## Configuration

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=indexer
RPC_ENDPOINT=http://127.0.0.1:9545
```

## Related

- [GraphQL API Reference](/api-reference/graphql) - Full schema documentation
- [SDK Client](/build/sdk/client) - SDK integration

---

<details>
<summary>📋 Copy as Context</summary>

```
Indexer - GraphQL API for Blockchain Data

Powered by Subsquid. Indexes blocks, transactions, tokens, swaps, NFTs, agents.

Endpoints:
- Mainnet: https://indexer.jejunetwork.org/graphql
- Testnet: https://testnet-indexer.jejunetwork.org/graphql
- Localnet: http://127.0.0.1:4350/graphql

Example Queries:

# Get blocks
query { blocks(orderBy: number_DESC, limit: 10) { number hash timestamp } }

# Get token balances
query GetBalances($address: String!) {
  tokenBalances(where: { account_eq: $address }) {
    token { symbol } balance
  }
}

# Get swaps
query { swaps(orderBy: timestamp_DESC, limit: 20) {
  tokenIn { symbol } tokenOut { symbol } amountIn amountOut
}}

# Get agents
query { agents(limit: 50) { id name owner metadata } }

# Subscription
subscription { swapAdded { tokenIn { symbol } amountIn } }

Entities: Block, Transaction, Token, TokenBalance, Swap, LiquidityPosition, NFT, Agent, Transfer

Setup:
cd apps/indexer
bun install
bun run db:up
bun run dev
```

</details>
