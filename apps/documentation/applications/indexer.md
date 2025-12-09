# Indexer

Subsquid blockchain indexer with GraphQL API.

**URL**: http://127.0.0.1:4350/graphql

## What's Indexed

- Blocks, transactions, logs
- ERC20/721/1155 tokens
- Contracts with type detection
- Prediction markets
- Node staking
- ERC-8004 registry

## Queries

```graphql
# Recent blocks
{
  blocks(limit: 10, orderBy: number_DESC) {
    number timestamp transactionCount
  }
}

# Token transfers
{
  tokenTransfers(limit: 20, where: { tokenStandard_eq: "ERC20" }) {
    from { address } to { address } value
  }
}
```

## Development

```bash
cd apps/indexer
bun install
bun run db:up
bun run dev
```

## Configuration

Environment loaded from `packages/config/ports.ts`:
- DB_PORT: 23798
- GQL_PORT: 4350
- RPC: http://127.0.0.1:9545

## Troubleshooting

```bash
# Check database
docker ps | grep squid-db

# Reset
bun run db:reset && bun run dev

# RPC check
curl -X POST http://127.0.0.1:9545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```
