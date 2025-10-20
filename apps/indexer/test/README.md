# Indexer Test Suite

## Test Scripts

### `basic.sh`
Basic functionality test - verifies database, build, processor, and API.

```bash
npm run test
```

**Checks**:
- ✅ Database connection
- ✅ Table count (15 expected)
- ✅ TypeScript build
- ✅ Processor starts
- ✅ API responds

---

### `localnet.sh`
Full localnet integration test - verifies indexing from Jeju L2.

```bash
npm run test:localnet
```

**Steps**:
1. Checks localnet RPC is running
2. Configures indexer for localnet
3. Starts indexer in background
4. Waits for blocks to be indexed
5. Verifies data captured

**Prerequisites**: `bun run localnet:start` from project root

---

### `real-data.sh`
Data verification test - checks actual indexed data quality.

```bash
npm run test:data
```

**Validates**:
- Blocks indexed (count > 0)
- Transactions indexed
- Event logs captured
- Events decoded
- Token transfers tracked
- Contracts detected
- ERC20 detection working
- Accounts tracked

**Passes if**: All 8 checks pass

---

### `contract-interaction.sh`
Contract deployment and interaction test.

```bash
npm run test:contracts
```

**Flow**:
1. Checks prerequisites (localnet + database)
2. Gets initial DB state
3. Starts indexer
4. Deploys test contract (or uses existing)
5. Waits for indexing
6. Verifies new data captured

---

### `e2e.test.sh`
End-to-end test (existing).

```bash
npm run test:e2e
```

---

### `integration.test.ts`
TypeScript integration test (existing).

```bash
npm run test:integration
```

---

## Run All Tests

```bash
npm run test:all
```

Runs: basic → real-data → e2e

---

## Test Requirements

**For localnet tests**:
- Jeju localnet running on port 8545
- `bun run dev` from project root

**For basic tests**:
- PostgreSQL database running (auto-started by npm run dev)

**For data tests**:
- Indexer has run for at least 1 minute
- Some blocks have been processed

---

## Expected Results

### Basic Test
```
✅ ALL TESTS PASSED!
```

### Real Data Test
```
✅ ALL 8 TESTS PASSED!

Summary:
  - 390 blocks indexed
  - 55,613 transactions
  - 309,406 event logs
  - 233,451 decoded events
  - 233,451 token transfers
  - 5,968 contracts (including 2,024 ERC20 tokens)
  - 204,942 unique accounts
```

---

## Troubleshooting

### Database Connection Failed
```bash
npm run db:up
npm run db:wait
npm run db:create
```

### Indexer Not Starting
```bash
npm run build
npm run db:migrate
```

### No Data Indexed
- Check RPC_ETH_HTTP in .env
- Verify localnet is running: `curl http://localhost:8545`
- Check indexer logs: `docker logs squid-processor-1`

### Tests Fail
```bash
# Reset everything
npm run db:reset
npm run build
npm run dev
```

