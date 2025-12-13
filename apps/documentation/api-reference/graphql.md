# GraphQL API

The Indexer provides a GraphQL API for blockchain data queries.

## Endpoints

Localnet uses `http://127.0.0.1:4350/graphql` with WebSocket at `ws://127.0.0.1:4350/graphql`. Testnet uses `https://testnet-indexer.jeju.network/graphql` with WebSocket at `wss://testnet-indexer.jeju.network/graphql`. Mainnet uses `https://indexer.jeju.network/graphql` with WebSocket at `wss://indexer.jeju.network/graphql`.

## Schema Overview

### Core Types

**Block** contains id, number, hash, timestamp, and transactions. **Transaction** contains id, hash, from, to, value, gasUsed, block, and events. **Token** contains id, address, name, symbol, decimals, and totalSupply. **TokenBalance** contains id, account, token, and balance.

### Protocol Types

**Agent** (ERC-8004) contains id, address, name, description, a2aEndpoint, mcpEndpoint, metadataUri, active, and registrationTime. **Intent** (OIF) contains id, hash, user, sourceChain, destinationChain, inputToken, inputAmount, outputToken, minOutputAmount, deadline, status, and fill. **IntentStatus** is an enum with PENDING, FILLED, CANCELLED, and EXPIRED values.

## Example Queries

### Get Recent Blocks

```graphql
query RecentBlocks {
  blocks(orderBy: number_DESC, limit: 10) {
    number hash timestamp
    transactions { hash }
  }
}
```

### Get Account Transactions

```graphql
query AccountTransactions($address: String!) {
  transactions(
    where: { OR: [{ from_eq: $address }, { to_eq: $address }] }
    orderBy: block_number_DESC
    limit: 50
  ) {
    hash from to value
    block { number timestamp }
  }
}
```

### Get Token Balances

```graphql
query TokenBalances($account: String!) {
  tokenBalances(where: { account_eq: $account }) {
    token { symbol decimals }
    balance
  }
}
```

### Get Pending Intents

```graphql
query PendingIntents {
  intents(where: { status_eq: PENDING } orderBy: deadline_ASC) {
    hash user inputToken inputAmount
    outputToken minOutputAmount deadline
  }
}
```

## Subscriptions

### New Blocks

```graphql
subscription NewBlocks {
  blocks { number hash timestamp }
}
```

### Intent Updates

```graphql
subscription IntentUpdates($user: String!) {
  intents(where: { user_eq: $user }) {
    hash status
    fill { solver outputAmount }
  }
}
```

## Using the API

### JavaScript

```typescript
const response = await fetch('https://indexer.jeju.network/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query { blocks(limit: 10, orderBy: number_DESC) { number hash } }`,
  }),
});
const { data } = await response.json();
```

### With Apollo Client

```typescript
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';

const client = new ApolloClient({
  uri: 'https://indexer.jeju.network/graphql',
  cache: new InMemoryCache(),
});

const { data } = await client.query({
  query: gql`query { blocks(limit: 10) { number hash } }`,
});
```

## Pagination

Use `limit` and `offset` for offset pagination. Use cursor-based pagination with `first`, `after`, and `pageInfo { hasNextPage endCursor }` for large datasets.

## Filters

Use the `where` clause with operators like `_eq` (equal), `_not_eq` (not equal), `_gt` (greater than), `_gte` (greater or equal), `_lt` (less than), `_lte` (less or equal), `_in` (in array), `_contains` (string contains), and `_startsWith` (string starts with). Combine with `AND` and `OR` for complex filters.

## Rate Limits

Public tier allows 60 queries/min. Registered tier allows 600 queries/min.

## GraphQL Playground

Visit the GraphQL endpoint in a browser to access the interactive playground with documentation and autocomplete.
