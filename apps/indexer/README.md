# Indexer

Blockchain data indexer powered by Subsquid. Provides GraphQL API for blocks, transactions, events, and tokens.

## Setup

```bash
cd apps/indexer
bun install
```

## Run

```bash
# Start PostgreSQL
bun run db:up

# Start indexer
bun run dev
```

GraphQL API on http://localhost:4350/graphql

## Test

```bash
# All tests
bun run test

# GraphQL queries
./test/verify-all-queries.sh

# Integration tests
./test/integration-bazaar.sh
```
