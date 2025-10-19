# Gateway Portal - Testing Quick Start

## 1. Setup (One Time)

```bash
# From gateway directory
cd apps/gateway

# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install chromium
```

## 2. Start Test Environment

```bash
# From repo root - starts everything
bun run dev
```

This starts:
- ✅ Jeju Localnet (port 9545)
- ✅ Gateway UI (port 4001)
- ✅ A2A Server (port 4003)
- ✅ All other infrastructure

## 3. Deploy Contracts (if not already done)

```bash
# From repo root
bun run scripts/deploy-paymaster-system.ts
```

This creates `.env.local` with all contract addresses.

## 4. Run Tests

### Fast Tests First (~30s)
```bash
cd apps/gateway

# Unit tests (instant)
bun run test:unit

# Contract tests (~10s)
bun run test:contracts

# A2A tests (~5s)
bun run test:a2a
```

### E2E Tests (~5min)
```bash
# Headless mode (CI-friendly)
bun run test:e2e

# With visible browser (easier debugging)
bun run test:e2e:headed

# Debug specific test
bun run test:e2e:debug tests/e2e/01-wallet-connection.spec.ts
```

### All Tests
```bash
bun run test:all
```

## 5. View Results

### Test Report (E2E only)
```bash
bun run test:report
```

Opens HTML report in browser with:
- Screenshots of failures
- Videos of test runs
- Execution traces
- Timing information

### Console Output
- ✅ Green = Passed
- ❌ Red = Failed
- ⏭️ Yellow = Skipped

## Test Files Overview

### E2E Tests (User Flows)
| File | Tests | What It Covers |
|------|-------|----------------|
| `01-wallet-connection.spec.ts` | 5 | Wallet setup, connection, MetaMask integration |
| `02-token-registry.spec.ts` | 7 | Token registration, validation, display |
| `03-bridge-tokens.spec.ts` | 8 | Bridge from Base, custom tokens, elizaOS exclusion |
| `04-deploy-paymaster.spec.ts` | 7 | Paymaster deployment for all tokens |
| `05-liquidity-provision.spec.ts` | 7 | Add/remove liquidity, LP dashboard, fees |
| `06-node-staking.spec.ts` | 11 | Node registration, management, rewards |
| `07-app-registry.spec.ts` | 11 | App registration, discovery, ERC-8004 |

### Contract Tests (Direct Blockchain)
| File | Tests | What It Covers |
|------|-------|----------------|
| `token-registry.test.ts` | 4 | Registry functions, fees, configs |
| `paymaster-factory.test.ts` | 4 | Factory deployments, validation |
| `liquidity-vault.test.ts` | 4 | LP positions, vault state |
| `node-staking.test.ts` | 7 | Node stats, rewards, distribution |
| `identity-registry.test.ts` | 7 | Agent registration, stakes, tags |

### A2A Tests (Agent Protocol)
| File | Tests | What It Covers |
|------|-------|----------------|
| `agent-discovery.test.ts` | 8 | Agent card, skills, JSON-RPC |
| `governance-agent.test.ts` | 4 | Futarchy governance agent |

## Debugging Tips

### Test Fails with "Element not found"
- Add explicit waits: `await page.waitForSelector('...')`
- Check if element is in a modal or dropdown
- Verify element text matches exactly (case-sensitive)

### Transaction Reverts
- Check wallet has sufficient ETH
- Verify contract addresses are correct
- Ensure contracts are deployed
- Check function parameters match ABI

### MetaMask Won't Connect
- Ensure test runs in headed mode (not headless)
- Check network is added to MetaMask
- Verify RPC URL is accessible
- Clear browser cache and try again

### A2A Tests Fail
- Verify A2A server is running on port 4003
- Check agent card JSON is valid
- Test endpoint manually: `curl http://localhost:4003/.well-known/agent-card.json`

## Example Test Run

```bash
$ cd apps/gateway

$ bun run test:contracts

✓ TokenRegistry Contract
  ✓ should read registration fee
  ✓ should get all registered tokens
  ✓ should read token config
  ✓ should validate fee margin bounds

✓ PaymasterFactory Contract
  ✓ should get all deployments
  ✓ should read deployment details
  ✓ should verify deployment creates all three contracts

✓ LiquidityVault Contract
  ✓ should read LP position
  ✓ should validate vault has correct token
  ✓ should track total ETH liquidity

✓ NodeStakingManager Contract
  ✓ should read network stats
  ✓ should read operator stats
  ✓ should get operator nodes list
  ✓ should calculate pending rewards

✓ IdentityRegistry Contract
  ✓ should calculate required stake
  ✓ should get all registered agents
  ✓ should get agents by tag

26 tests passed in 8.5s
```

## Next Steps

1. ✅ Review test results
2. ✅ Fix any failing tests
3. ✅ Add tests for new features
4. ✅ Run E2E tests before deployment
5. ✅ Monitor test execution time
6. ✅ Update tests when contracts change

## Getting Help

- Check `tests/README.md` for detailed documentation
- Review `TESTING.md` for comprehensive guide
- Examine existing tests for examples
- Run tests in debug mode to inspect failures

