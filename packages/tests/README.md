# @jejunetwork/tests

Shared test utilities, fixtures, and helpers for Jeju Network E2E testing.

## Features

- **Test Locking** - Prevent concurrent E2E test runs from conflicting
- **Preflight Validation** - Verify chain health before running tests
- **App Warmup** - Pre-compile Next.js pages to avoid cold-start timeouts
- **On-Chain Verification** - Validate that tests change blockchain state (not LARP)
- **Synpress Integration** - MetaMask wallet automation with Playwright

## Quick Start

### Run All E2E Tests

```bash
# Full suite with lock + preflight + warmup
bun run test:e2e

# Run tests for a specific app
bun run test:e2e --app=bazaar

# Quick smoke test (just chain health)
bun run test:e2e --smoke

# List apps with E2E tests
bun run test:e2e --list
```

### Run Smoke Tests

```bash
# Chain health check (no wallet)
bun run test:smoke

# Wallet smoke test (requires Synpress)
bun run test:smoke:wallet
```

## Using in Your App

### 1. Create a synpress.config.ts

```typescript
import {
  createJejuSynpressConfig,
  createJejuWalletSetup,
  PASSWORD,
} from '@jejunetwork/tests/synpress.config.base';

const PORT = parseInt(process.env.MY_APP_PORT || '4000');

export default createJejuSynpressConfig({
  appName: 'my-app',
  port: PORT,
  testDir: './tests/wallet',
});

export const basicSetup = createJejuWalletSetup();
export { PASSWORD };
```

### 2. Write Tests with On-Chain Verification

```typescript
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../synpress.config';
import {
  verifyTransactionMined,
  verifyBalanceChanged,
  getEthBalance,
} from '@jejunetwork/tests/helpers/on-chain';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test('should execute swap and verify on-chain', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  // Connect wallet
  await page.goto('/');
  await page.getByRole('button', { name: /Connect/i }).click();
  await metamask.connectToDapp();

  // Get balance before
  const balanceBefore = await getEthBalance('0xf39F...' as Address);

  // Execute swap
  await page.fill('#amount', '1.0');
  await page.click('button:has-text("Swap")');
  await metamask.confirmTransaction();

  // Wait for and verify on-chain
  await page.waitForSelector('text=/Success/i');
  const txHash = await page.getAttribute('[data-tx-hash]', 'data-tx-hash');

  const receipt = await verifyTransactionMined(txHash as Hash);
  expect(receipt.status).toBe('success');

  // Verify balance changed
  await verifyBalanceChanged('0xf39F...' as Address, balanceBefore, {
    direction: 'decrease',
  });
});
```

### 3. Use Test Locking (for CI)

```typescript
import { withTestLock } from '@jejunetwork/tests/lock-manager';

async function runTests() {
  await withTestLock(async () => {
    // Your tests run here
    // Lock is automatically released on completion or error
  });
}
```

## Available Exports

### Main Entry (`@jejunetwork/tests`)

```typescript
// Lock Manager
export { LockManager, withTestLock, getDefaultLockManager } from './lock-manager';

// Preflight
export { runPreflightChecks, quickHealthCheck, waitForChain } from './preflight';

// Warmup
export { warmupApps, quickWarmup, discoverAppsForWarmup } from './warmup';

// Synpress Config
export { createJejuSynpressConfig, createJejuWalletSetup } from './synpress.config.base';

// On-Chain Helpers
export {
  verifyTransactionMined,
  verifyBalanceChanged,
  verifyTokenBalanceChanged,
  verifyContractDeployed,
  getEthBalance,
  getTokenBalance,
} from './helpers/on-chain';

// Synpress Fixtures
export { test, expect, connectAndVerify, verifyAuth } from './fixtures/synpress-wallet';
```

### Helpers (`@jejunetwork/tests/helpers`)

- `contracts.ts` - Wallet/dApp interaction helpers (approve, swap, bridge)
- `screenshots.ts` - Screenshot capture utilities
- `navigation.ts` - Page navigation helpers
- `error-detection.ts` - Error detection utilities
- `on-chain.ts` - Blockchain state verification

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `L2_RPC_URL` | RPC URL for chain | `http://localhost:9545` |
| `CHAIN_ID` | Chain ID | `1337` |
| `SKIP_TEST_LOCK` | Skip lock acquisition | `false` |
| `SKIP_PREFLIGHT` | Skip chain validation | `false` |
| `SKIP_WARMUP` | Skip app warmup | `false` |
| `FORCE_TESTS` | Override existing lock | `false` |

## Test Structure

```
packages/tests/
├── shared/
│   ├── lock-manager.ts     # Test locking
│   ├── preflight.ts        # Chain validation
│   ├── warmup.ts           # App warmup
│   ├── global-setup.ts     # Playwright globalSetup
│   ├── synpress.config.base.ts
│   ├── fixtures/
│   │   ├── synpress-wallet.ts
│   │   └── wallet.ts
│   └── helpers/
│       ├── on-chain.ts     # Blockchain verification
│       ├── contracts.ts    # UI interaction
│       ├── screenshots.ts
│       └── navigation.ts
├── smoke/
│   ├── chain-preflight.spec.ts  # Chain health
│   └── wallet-smoke.spec.ts     # Wallet integration
└── package.json
```

## Prerequisites

1. **Docker** - For running localnet (Kurtosis)
2. **Bun** - Runtime
3. **Playwright** - Test framework
4. **Synpress** - Wallet automation

## Running Locally

```bash
# Start localnet
bun run dev

# In another terminal, run tests
bun run test:e2e

# Or run smoke tests first
bun run test:smoke
```

