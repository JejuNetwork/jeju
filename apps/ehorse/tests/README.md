# eHorse Test Suite

Comprehensive E2E tests verifying complete prediction market cycle.

## Test Coverage

### 1. Race Creation (`01-race-creation.spec.ts`)
- ✅ UI displays 4 horses
- ✅ Race progresses through states (pending → running → finished)
- ✅ Race history displayed
- ✅ Oracle status indicator

### 2. Oracle Commitment (`02-oracle-commitment.spec.ts`)
- ✅ GameServer configured correctly
- ✅ Race commits to oracle on start
- ✅ GameCommitted event emitted
- ✅ Commitment hash stored on-chain
- ✅ Race reveals on finish
- ✅ GameRevealed event emitted
- ✅ Outcome matches winner

### 3. Market Creation (`03-market-creation.spec.ts`)
- ✅ MarketFactory watches oracle
- ✅ Market auto-created when race starts
- ✅ MarketAutoCreated event emitted
- ✅ Market exists on Predimarket
- ✅ Binary mapping correct (horses 1-2 vs 3-4)

### 4. Agent Betting (`04-agent-betting.spec.ts`)
- ✅ Agent has elizaOS balance
- ✅ Wallet connection via MetaMask (Dappwright)
- ✅ elizaOS approval
- ✅ Bet placement
- ✅ SharesPurchased event emitted
- ✅ Position recorded on-chain

### 5. Multi-Token Betting (`05-multi-token-betting.spec.ts`)
- ✅ elizaOS betting
- ✅ CLANKER betting
- ✅ VIRTUAL betting
- ✅ CLANKERMON betting
- ✅ All tokens supported
- ✅ Events show correct payment token

### 6. Complete Cycle (`06-complete-cycle.spec.ts`)
- ✅ Race creation
- ✅ Oracle commitment
- ✅ Market creation
- ✅ Agent betting
- ✅ Race completion
- ✅ Oracle reveal
- ✅ Market resolution
- ✅ Payout claim
- ✅ Full cycle in <3 minutes

### 7. On-Chain State Viewer (`07-on-chain-state-viewer.spec.ts`)
- ✅ State panel UI loads
- ✅ Shows current race
- ✅ Shows oracle state
- ✅ Shows market state
- ✅ Shows recent events
- ✅ Shows configuration
- ✅ Shows health status
- ✅ Auto-updates every 5s

## Running Tests

### Prerequisites

1. **Anvil running**:
   ```bash
   # In separate terminal
   anvil
   ```

2. **Contracts deployed**:
   ```bash
   bun run test:setup
   ```
   
   This deploys:
   - PredictionOracle
   - Predimarket
   - MarketFactory
   - All 4 tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
   - Funds test wallets
   - Configures everything

3. **eHorse running**:
   ```bash
   # Load test environment
   source .env.test
   
   # Start eHorse
   bun run dev
   ```

### Run All Tests

```bash
# Complete test suite
bun run test:complete
```

This runs:
1. `test:setup` - Deploy contracts & configure
2. `test:e2e` - Run all E2E tests

### Run Individual Test Suites

```bash
# Just setup
bun run test:setup

# Just E2E tests (assumes setup already done)
bun run test:e2e

# Interactive UI mode
bun run test:e2e:ui

# Specific test file
npx playwright test tests/e2e/06-complete-cycle.spec.ts

# With headed browser (see what's happening)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

## Test Environment

### Test Configuration

After running `test:setup`, you'll have:

**test-config.json**:
```json
{
  "rpcUrl": "http://localhost:8545",
  "chainId": 31337,
  "addresses": {
    "elizaOS": "0x...",
    "clanker": "0x...",
    "virtual": "0x...",
    "clankermon": "0x...",
    "predictionOracle": "0x...",
    "predimarket": "0x...",
    "marketFactory": "0x..."
  },
  "testWallets": [...]
}
```

**.env.test**:
```bash
# All contract addresses
# All test wallet keys
# Ready to use
```

### Test Wallets

4 funded wallets with ALL tokens:

| Wallet | Address | Balance (each token) |
|--------|---------|---------------------|
| Deployer | 0xf39F... | 10,000 |
| Agent1 | 0x7099... | 10,000 |
| Agent2 | 0x3C44... | 10,000 |
| Agent3 | 0x90F7... | 10,000 |

## What Tests Verify

### On-Chain Data Flow

```
✅ eHorse creates race
✅ Race data stored off-chain
✅ Oracle commitment stored on-chain
✅ GameCommitted event emitted
✅ MarketCreator hears event
✅ Market created on Predimarket
✅ MarketCreated event emitted
✅ Agent queries market
✅ Agent places bet
✅ SharesPurchased event emitted
✅ Position stored on-chain
✅ Race finishes
✅ Oracle reveal stored on-chain
✅ GameRevealed event emitted
✅ Market resolved on Predimarket
✅ MarketResolved event emitted
✅ Winner claims payout
✅ PayoutClaimed event emitted
✅ Balance updated on-chain
```

**Complete blockchain state verification!**

### Multi-Token Support

Tests verify ALL 4 protocol tokens work:

```
✅ elizaOS - Default token
✅ CLANKER - AI agent token
✅ VIRTUAL - Virtual protocol token
✅ CLANKERMON - Game token
```

Each token tested for:
- Support enabled in Predimarket
- Agent has balance
- Approval works
- Betting works
- Events show correct token
- Payouts work

## Test Reports

After running tests:

```bash
# View HTML report
npx playwright show-report

# View traces (if test failed)
npx playwright show-trace trace.zip
```

## Debugging Tests

### View Browser

```bash
# See browser during tests
npx playwright test --headed

# Debug mode (step through)
npx playwright test --debug
```

### Slow Down Tests

```bash
# Add delays to see what's happening
npx playwright test --slow-mo=1000
```

### Check Blockchain State

During tests, in another terminal:

```bash
# Watch events
cast logs --address $ORACLE_ADDRESS --follow

# Check latest block
cast block latest

# Query contract
cast call $PREDIMARKET_ADDRESS "markets(bytes32)" $SESSION_ID
```

## Common Issues

### "Test config not found"
→ Run `bun run test:setup` first

### "Contract not found"
→ Anvil might have restarted, run `test:setup` again

### "Insufficient funds"
→ Check wallets were funded in setup

### "Transaction reverted"
→ Check game server is set in oracle
→ Check Predimarket owner is MarketFactory

### "Market not created"
→ Check MARKET_FACTORY_ADDRESS is set
→ Check MarketCreator is running in eHorse

## Test Timeouts

Different tests have different timeouts:

| Test | Timeout | Why |
|------|---------|-----|
| Race creation | 30s | Quick test |
| Oracle commitment | 60s | Wait for race start |
| Market creation | 60s | Wait for async creation |
| Agent betting | 90s | Wait for race + market |
| Complete cycle | 180s | Full race lifecycle |

## CI/CD Integration

To run in CI:

```yaml
# .github/workflows/test-ehorse.yml
steps:
  - name: Start Anvil
    run: anvil &
  
  - name: Setup Test Environment
    run: cd apps/ehorse && bun run test:setup
  
  - name: Start eHorse
    run: cd apps/ehorse && bun run dev &
  
  - name: Run E2E Tests
    run: cd apps/ehorse && bun run test:e2e
```

## Performance

Test suite runs in:
- Setup: ~30 seconds
- E2E tests: ~5 minutes
- **Total: <6 minutes**

Much faster than Caliguland's 30+ minute test suite!

## Success Criteria

All tests pass when:
- ✅ Races create automatically
- ✅ Oracle stores commitments
- ✅ Markets auto-create
- ✅ All 4 tokens work for betting
- ✅ Payouts work correctly
- ✅ State viewer shows accurate data

Run `bun run test:complete` to verify everything!



