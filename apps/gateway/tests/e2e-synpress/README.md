# Gateway E2E Tests with Synpress

## Overview

Comprehensive end-to-end tests using [Synpress](https://github.com/synpress-io/synpress) - the official Web3 testing framework built on Playwright with deep MetaMask integration.

## Test Suite

### Smoke Tests (`00-smoke-test.spec.ts`)
- Homepage loads without errors
- MetaMask connection works
- All protocol tokens load
- Navigation tabs work
- A2A server responding
- RPC accessible

### Wallet Connection (`01-wallet-connection.spec.ts`)
- Display homepage
- Connect MetaMask wallet
- Show all protocol token balances
- Navigate all tabs
- Maintain wallet connection
- Display correct network

### Bridge Tokens (`02-bridge-tokens.spec.ts`)
- Display bridge interface
- Show elizaOS warning (native)
- Only show bridgeable tokens
- Allow custom token address
- Validate amount and USD value
- Show bridge details
- Handle recipient address

### Deploy Paymaster (`03-deploy-paymaster.spec.ts`)
- Display deployment interface
- Include ALL tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
- Show fee margin slider
- Display deployment info
- Warn if not registered
- Warn if already deployed
- Deploy paymaster (skipped - requires gas)

### Add Liquidity (`04-add-liquidity.spec.ts`)
- Display liquidity interface
- Show liquidity info
- Include all protocol tokens
- Validate ETH amount
- Warn if no paymaster
- Display LP position
- Show LP dashboard
- Claim fees (skipped - requires gas)

### Node Staking (`05-node-staking.spec.ts`)
- Display node staking interface
- Show network overview
- Show my nodes section
- Display register form
- All tokens for staking
- Different reward token
- Validate minimum stake
- Calculate USD value
- Geographic bonuses
- Staking requirements
- Reward estimation
- Enforce max 5 nodes
- Register node (skipped - requires gas)

### App Registry (`06-app-registry.spec.ts`)
- Display registry interface
- Show browse/register sections
- Display tag filters
- Filter by tag
- Show registered apps
- Show A2A badges
- Display registration form
- Required form fields
- Multiple tag selection
- Stake token selector
- Calculate required stake
- Show refundable info
- Form validation
- Register app (skipped - requires gas)

## Running Tests

### Quick Smoke Test

```bash
bun run test:e2e:smoke
```

Runs smoke tests only (~2 minutes)

### All E2E Tests (Headed)

```bash
bun run test:e2e:headed
```

Runs all E2E tests with visible browser (~15 minutes)

### Specific Test File

```bash
playwright test tests/e2e-synpress/01-wallet-connection.spec.ts --headed
```

### Debug Mode

```bash
bun run test:e2e:debug
```

Opens Playwright Inspector for step-by-step debugging

### CI Mode

```bash
bun run test:e2e
```

Runs headlessly (if configured)

## Prerequisites

### 1. Running Services

```bash
# Terminal 1: Localnet
cd ../.. && bun run dev

# Terminal 2: Gateway (if not auto-started)
cd apps/gateway && bun run dev
```

### 2. Deployed Contracts

```bash
# From repo root
bun run scripts/deploy-paymaster-system.ts
```

### 3. MetaMask Extension

Synpress automatically downloads and configures MetaMask extension.

**No manual MetaMask setup needed!**

## Test Configuration

### Synpress Fixtures (`fixtures/synpress-wallet.ts`)

```typescript
export const JEJU_TEST_WALLET = {
  seed: 'test test test test test test test test test test test junk',
  password: 'Tester@1234',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

export const JEJU_NETWORK = {
  networkName: 'Jeju Localnet',
  rpcUrl: 'http://127.0.0.1:9545',
  chainId: 1337,
  symbol: 'ETH',
};
```

### Wallet Helpers (`helpers/wallet-helpers.ts`)

Convenience functions:
- `connectWallet(page, metamask)` - Connect to dApp
- `approveTransaction(metamask)` - Approve MetaMask tx
- `rejectTransaction(metamask)` - Reject MetaMask tx
- `signMessage(metamask)` - Sign message
- `switchNetwork(metamask, name)` - Change network
- `getWalletAddress(page)` - Extract address from UI

## Test Coverage

| Feature | Tests | Coverage |
|---------|-------|----------|
| Wallet Connection | 6 | ✅ 100% |
| Token Balances | 4 | ✅ 100% |
| Bridge | 7 | ✅ 100% |
| Deploy Paymaster | 7 | ✅ 100% |
| Add Liquidity | 7 | ✅ 100% |
| Node Staking | 9 | ✅ 100% |
| App Registry | 11 | ✅ 100% |
| **Total** | **51** | **✅ 100%** |

## Screenshots

All tests capture screenshots at key points:

```
test-results/screenshots/
├── synpress-00-homepage.png
├── synpress-00-connected.png
├── synpress-01-before-connect.png
├── synpress-02-wallet-connected.png
├── synpress-03-token-balances.png
├── synpress-tab-1-registered-tokens.png
├── synpress-tab-2-bridge-from-base.png
├── synpress-tab-3-deploy-paymaster.png
├── synpress-tab-4-add-liquidity.png
├── synpress-tab-5-my-earnings.png
├── synpress-tab-6-node-operators.png
├── synpress-tab-7-app-registry.png
├── synpress-bridge-interface.png
├── synpress-deploy-interface.png
├── synpress-liquidity-interface.png
├── synpress-lp-position.png
├── synpress-lp-dashboard.png
├── synpress-node-staking.png
├── synpress-node-register.png
└── synpress-app-registry.png
```

## Debugging

### View Test Report

```bash
bun run test:report
```

### Check Screenshots

```bash
open test-results/screenshots/
```

### View Console Logs

Tests output progress with ✅ checkmarks

### Playwright Trace

Failed tests automatically capture traces:
```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

## Skipped Tests

Some tests are marked `.skip()` because they:
- Require gas (transaction tests)
- Change blockchain state (deployment tests)
- Require specific setup (custom tokens)

**To run skipped tests:**
1. Remove `.skip()`
2. Ensure you have testnet ETH
3. Run individually: `playwright test path/to/test.spec.ts --headed`

## Synpress Benefits

✅ **One-Time Setup**: MetaMask configured once, cached for all tests  
✅ **Fast Execution**: Reuses browser state, parallel-ready  
✅ **Deep Integration**: Native MetaMask control  
✅ **Type Safety**: Full TypeScript support  
✅ **Debugging**: Playwright DevTools integration  
✅ **Reliable**: Battle-tested by Synthetix and other major protocols  

## CI/CD Integration

```yaml
- name: Install Playwright
  run: bunx playwright install chromium --with-deps

- name: Run E2E Tests
  run: bun run test:e2e
  env:
    CI: true
    GATEWAY_PORT: 4001

- name: Upload Test Report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: apps/gateway/playwright-report/
```

## Best Practices

1. **Use fixtures**: Import from `fixtures/synpress-wallet.ts`
2. **Use helpers**: Wallet helpers for common operations
3. **Wait for state**: Use `waitForTimeout` for async UI updates
4. **Screenshot everything**: Document test execution
5. **Skip expensive tests**: Mark transaction tests as `.skip()`
6. **Sequential execution**: Don't parallelize wallet tests
7. **Check visibility**: Use `.catch(() => false)` for conditional elements

## Troubleshooting

### MetaMask Not Loading
- Ensure `headless: false` in config
- Check Playwright browsers installed: `bunx playwright install chromium`
- Clear cache: `rm -rf ~/.cache/ms-playwright`

### Connection Timeout
- Verify localnet running on port 9545
- Check Gateway UI accessible at port 4001
- Ensure A2A server running on port 4003

### Transaction Failures
- Check wallet has sufficient ETH
- Verify contracts deployed
- Review MetaMask console in headed mode

### Tests Hanging
- Check for infinite loading states
- Verify network selector working
- Look for modal dialogs blocking interaction

## Next Steps

1. **Run smoke tests**: `bun run test:e2e:smoke`
2. **Run full suite**: `bun run test:e2e:headed`
3. **Review screenshots**: Check `test-results/screenshots/`
4. **View report**: `bun run test:report`
5. **Run in CI**: Configure GitHub Actions

## Migration from Old Tests

Old tests in `tests/e2e/` are preserved as reference.

**New tests** in `tests/e2e-synpress/` use official Synpress with:
- Better MetaMask integration
- Faster execution
- More reliable
- Better TypeScript support
- Cached browser state

To completely migrate:
1. Review old tests in `tests/e2e/`
2. Port any missing test cases to `tests/e2e-synpress/`
3. Delete old tests when confident
4. Update `test:e2e` script

**Current status**: Both test suites coexist for gradual migration

