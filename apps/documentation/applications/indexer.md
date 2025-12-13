# Indexer

Indexer is Jeju's blockchain data API. It continuously processes blocks, transactions, and events, storing them in a queryable database. All Jeju apps use the Indexer's GraphQL API to display on-chain data.

**URLs:** Localnet at http://127.0.0.1:4350/graphql, testnet at https://indexer-testnet.jeju.network/graphql, mainnet at https://indexer.jeju.network/graphql

## Why Use the Indexer

Direct RPC queries are inefficient for complex data needs. If you need all transfers to an address in the last week, direct RPC requires scanning 100,000+ blocks one by one. The Indexer pre-processes this data so the same query returns in under 100ms.

The Indexer tracks core blockchain data (blocks, transactions, receipts, logs), token data (balances, transfers, approvals), NFT data (ownership, transfers, metadata), OIF data (intents, fills, settlements), EIL data (bridge deposits, withdrawals, claims), agent data (registrations, updates, activity), compute data (providers, sessions, payments), storage data (pins, retrievals, providers), and staking data (stakes, rewards, slashing).

## GraphQL API

### Playground

Visit http://localhost:4350/graphql for an interactive query builder with documentation and autocomplete.

### Query Structure

Queries follow a consistent pattern with entity queries that accept filters, ordering, and limits, singular queries for fetching by ID or unique field, and aggregation queries for counts and sums.

### Filtering

All entities support rich filtering with exact matches, list membership, comparisons, boolean logic (AND/OR), and nested filters for related entities.

```graphql
query {
  transactions(
    where: {
      from_eq: "0x..."
      status_in: [SUCCESS, REVERTED]
      value_gte: "1000000000000000000"
      OR: [{ from_eq: "0x..." }, { to_eq: "0x..." }]
      block: { number_gte: 1000000 }
    }
  ) {
    hash
    from
    to
    value
  }
}
```

### Ordering and Pagination

```graphql
query {
  transactions(
    orderBy: block_number_DESC
    limit: 50
    offset: 100
  ) {
    hash
    block { number }
  }
}
```

## Common Queries

### Recent Blocks

```graphql
query RecentBlocks {
  blocks(orderBy: number_DESC, limit: 10) {
    number
    hash
    timestamp
    transactionsCount
    gasUsed
  }
}
```

### Account Activity

```graphql
query AccountActivity($address: String!) {
  transactions(
    where: { OR: [{ from_eq: $address }, { to_eq: $address }] }
    orderBy: block_number_DESC
    limit: 50
  ) {
    hash
    from
    to
    value
    gasUsed
    status
    block { number timestamp }
  }
}
```

### Token Balances

```graphql
query TokenBalances($account: String!) {
  tokenBalances(where: { account_eq: $account }) {
    balance
    token { address symbol name decimals }
  }
}
```

### Token Transfers

```graphql
query TokenTransfers($token: String!) {
  tokenTransfers(
    where: { token_eq: $token }
    orderBy: block_number_DESC
    limit: 100
  ) {
    from
    to
    amount
    transactionHash
    block { timestamp }
  }
}
```

### Registered Agents

```graphql
query ActiveAgents {
  agents(where: { active_eq: true }) {
    id
    address
    name
    description
    a2aEndpoint
    mcpEndpoint
    registrationTime
  }
}
```

### OIF Intents

```graphql
query PendingIntents {
  intents(where: { status_eq: PENDING }) {
    hash
    user
    sourceChain
    destinationChain
    inputToken
    inputAmount
    outputToken
    minOutputAmount
    deadline
  }
}
```

### Compute Providers

```graphql
query ComputeProviders {
  computeProviders(where: { active_eq: true }) {
    id
    endpoint
    pricePerHour
    hardware { gpuModel gpuCount cpuCores memory }
    stats { totalSessions totalRevenue uptime }
  }
}
```

## Real-time Subscriptions

Subscribe to live updates via WebSocket for immediate notification of new data.

### New Blocks

```graphql
subscription NewBlocks {
  newBlock {
    number
    hash
    timestamp
  }
}
```

### Token Transfers

```graphql
subscription TokenTransfers($token: String!) {
  tokenTransfer(token: $token) {
    from
    to
    amount
    transactionHash
  }
}
```

### Intent Updates

```graphql
subscription IntentUpdates($user: String!) {
  intentUpdated(user: $user) {
    hash
    status
    fill { solver outputAmount }
  }
}
```

### Using in JavaScript

```typescript
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'ws://localhost:4350/graphql',
});

client.subscribe(
  { query: `subscription { newBlock { number hash } }` },
  {
    next: (data) => console.log('New block:', data),
    error: (err) => console.error('Error:', err),
    complete: () => console.log('Complete'),
  }
);
```

## REST API

Alternative REST endpoints are available for simple queries.

`/api/blocks/latest` returns the latest block. `/api/blocks/:number` returns a block by number. `/api/blocks/:hash` returns a block by hash. `/api/tx/:hash` returns transaction details. `/api/address/:address` returns address summary. `/api/address/:address/txs` returns address transactions. `/api/address/:address/tokens` returns token balances. `/api/tokens` lists all tokens. `/api/tokens/:address` returns token details.

```bash
curl http://localhost:4350/api/blocks/latest
```

## Agent Integration

Agents can query the Indexer via A2A or MCP.

A2A skills include `get_block` for block data, `get_transaction` for transaction details, `get_token_balance` for address balances, `query_events` for contract events, `search_agents` for finding registered agents, and `get_intent_status` for checking intent status.

```bash
curl -X POST http://localhost:4350/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "get_token_balance",
      "parameters": {"address": "0x...", "token": "0x..."}
    }
  }'
```

## Processors

The Indexer runs multiple specialized processors. The main processor handles blocks, transactions, and logs. The tokens processor handles ERC-20 transfers and approvals. The nft processor handles ERC-721/1155 transfers and mints. The oif processor handles intent creation and filling. The eil processor handles bridge deposits and withdrawals. The compute processor handles provider registration and sessions. The storage processor handles pins and retrievals. The registry processor handles agent registration. The staking processor handles stakes and rewards.

## Database Schema

Key tables include `blocks` (number, hash, timestamp), `transactions` (hash, from, to, value), `events` (block_number, address, topics, data), `token_balances` (account, token, balance), `agents` (address, name, endpoints), and `intents` (hash, user, status).

## Setup & Configuration

Install with `cd apps/indexer && bun install`. Start PostgreSQL with `bun run db:up` and run migrations with `bun run db:migrate`.

Configure environment variables for the database (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`), RPC endpoints (`RPC_URL`, `L1_RPC_URL`), and API settings (`API_PORT`, `WS_PORT`).

Run development with `bun run dev`. For production, run `bun run build` then `bun run start`.

## Operations

### Reset Database

Run `bun run db:reset` for a full reset or `bun run db:truncate` to just clear data.

### Reindex

Reindex from a specific block with `bun run reindex --from 0` or reindex a specific processor with `bun run reindex --processor oif --from 1000000`.

### Health Check

```bash
curl http://localhost:4350/health
```

Returns status, latest block, chain head, lag, and processor statuses.

## Testing

Run unit tests with `bun run test`, GraphQL query tests with `./test/verify-all-queries.sh`, and integration tests with `./test/integration-bazaar.sh`.

## Deployment

### Localnet

Indexer starts automatically with `bun run dev` from the root.

### Testnet/Mainnet

Build and migrate:

```bash
cd apps/indexer
bun run build
bun run db:migrate
```

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=indexer sync
```

### Required Secrets

Configure in AWS Secrets Manager or environment:
- `DATABASE_URL` — PostgreSQL connection string
- `RPC_URL` — Chain RPC endpoint
- `WS_RPC_URL` — WebSocket RPC for real-time events

### Docker

```bash
docker build -t jeju-indexer .
docker run -p 4003:4003 \
  -e DATABASE_URL=postgres://user:pass@db:5432/jeju \
  -e RPC_URL=https://rpc.jeju.network \
  jeju-indexer
```

### Database

The indexer requires PostgreSQL 14+. For production, use a managed database service. Schema migrations run automatically on startup or manually with `bun run db:migrate`.

### Scaling

For high-throughput chains, run multiple indexer replicas with partitioned block ranges. Configure `START_BLOCK` and `END_BLOCK` environment variables to split the workload.

## Common Issues

"Indexer falling behind" means the indexer is processing blocks slower than they're produced. Increase `BATCH_SIZE`, check database performance, or scale horizontally with processor replicas.

"Missing events" means events aren't appearing in query results. Check that the processor for that event is running, verify the contract address in the processor config, and check that the block number is past the event.

"Query timeout" means complex queries are timing out. Add indexes for frequently filtered fields, use pagination with limit and offset, or simplify nested queries.

## Next Steps

- [GraphQL Reference](/reference/api/graphql) — Full query documentation
- [Build Apps](/build/apps/overview) — Integrate with the indexer
