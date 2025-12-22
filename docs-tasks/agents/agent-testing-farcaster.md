# Agent Task: E2E Tests for Farcaster Posting Flows

## Priority: P1
## Estimated Time: 2 days
## Dependencies: All Farcaster agents

## Objective

Create comprehensive end-to-end tests for all Farcaster functionality using Synpress for wallet interactions and real hub API calls.

## Implementation Tasks

### 1. Test Setup

File: `packages/farcaster/tests/e2e/setup.ts`

```typescript
import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

export const TEST_SEED = 'test test test test test test test test test test test junk';
export const TEST_PASSWORD = 'TestPassword123';

// Wallet setup for Farcaster tests
export default defineWalletSetup(TEST_PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, TEST_PASSWORD);
  await metamask.importWallet(TEST_SEED);
  
  // Add Optimism for signer registration
  await metamask.addNetwork({
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    chainId: 10,
    symbol: 'ETH',
  });
  
  // Add Jeju testnet
  await metamask.addNetwork({
    name: 'Jeju Testnet',
    rpcUrl: 'https://rpc.testnet.jeju.network',
    chainId: 420691,
    symbol: 'JEJU',
  });
});

// Test FID (for testnet)
export const TEST_FID = parseInt(process.env.TEST_FID ?? '0');

// Hub URL
export const HUB_URL = process.env.HUB_URL ?? 'http://localhost:2281';
```

### 2. Authentication Tests

File: `packages/farcaster/tests/e2e/auth.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_FID } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Farcaster Authentication', () => {
  xtest('displays SIWF QR code', async ({ page }) => {
    await page.goto('/test/farcaster');
    
    // Click sign in with Farcaster
    await page.click('[data-testid="siwf-button"]');
    
    // Verify QR code is displayed
    await expect(page.locator('[data-testid="siwf-qr"]')).toBeVisible();
    await expect(page.locator('[data-testid="siwf-link"]')).toBeVisible();
  });
  
  xtest('creates signer when authenticated', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/farcaster');
    
    // Connect wallet
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    
    // Trigger signer creation (simulated auth)
    await page.click('[data-testid="create-signer"]');
    
    // Sign signer request message
    await metamask.confirmSignatureRequest();
    
    // Verify signer is created
    await expect(page.locator('[data-testid="signer-status"]')).toHaveText('Pending Approval');
    await expect(page.locator('[data-testid="approval-link"]')).toBeVisible();
  });
  
  xtest('shows profile after authentication', async ({ page }) => {
    await page.goto('/test/farcaster');
    
    // Simulate successful authentication
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
    
    // Verify profile is shown
    await expect(page.locator('[data-testid="fc-profile"]')).toBeVisible();
    await expect(page.locator('[data-testid="fc-fid"]')).toContainText(TEST_FID.toString());
  });
});
```

### 3. Posting Tests

File: `packages/farcaster/tests/e2e/posting.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_FID, HUB_URL } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Farcaster Posting', () => {
  xtest.beforeEach(async ({ page }) => {
    await page.goto('/test/farcaster');
    
    // Authenticate for tests
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
  });
  
  xtest('posts a cast', async ({ page }) => {
    const testText = `Test cast ${Date.now()}`;
    
    // Open composer
    await page.click('[data-testid="compose-cast"]');
    
    // Type cast content
    await page.fill('[data-testid="cast-input"]', testText);
    
    // Post
    await page.click('[data-testid="post-cast"]');
    
    // Verify cast appears
    await expect(page.locator('[data-testid="cast-success"]')).toBeVisible();
    
    // Verify on hub
    const response = await page.evaluate(async ({ hubUrl, fid }) => {
      const res = await fetch(`${hubUrl}/v1/castsByFid?fid=${fid}&pageSize=1`);
      return res.json();
    }, { hubUrl: HUB_URL, fid: TEST_FID });
    
    expect(response.messages[0].data.castAddBody.text).toBe(testText);
  });
  
  xtest('posts cast with embeds', async ({ page }) => {
    await page.click('[data-testid="compose-cast"]');
    
    const testText = 'Check out this link';
    const embedUrl = 'https://jeju.network';
    
    await page.fill('[data-testid="cast-input"]', testText);
    await page.fill('[data-testid="embed-url-input"]', embedUrl);
    await page.click('[data-testid="add-embed"]');
    
    await page.click('[data-testid="post-cast"]');
    
    await expect(page.locator('[data-testid="cast-success"]')).toBeVisible();
  });
  
  xtest('posts reply to cast', async ({ page }) => {
    // Find a cast to reply to
    const castHash = await page.evaluate(() => {
      return window.testHelpers.getRecentCastHash();
    });
    
    // Click reply on the cast
    await page.click(`[data-testid="reply-${castHash}"]`);
    
    const replyText = `Reply ${Date.now()}`;
    await page.fill('[data-testid="cast-input"]', replyText);
    await page.click('[data-testid="post-cast"]');
    
    await expect(page.locator('[data-testid="cast-success"]')).toBeVisible();
  });
  
  xtest('deletes a cast', async ({ page }) => {
    // First create a cast
    await page.click('[data-testid="compose-cast"]');
    await page.fill('[data-testid="cast-input"]', 'Cast to delete');
    await page.click('[data-testid="post-cast"]');
    
    await expect(page.locator('[data-testid="cast-success"]')).toBeVisible();
    
    // Get the cast hash
    const castHash = await page.evaluate(() => {
      return window.testHelpers.getLastPostedCastHash();
    });
    
    // Delete it
    await page.click(`[data-testid="delete-${castHash}"]`);
    await page.click('[data-testid="confirm-delete"]');
    
    // Verify deleted
    await expect(page.locator('[data-testid="delete-success"]')).toBeVisible();
  });
  
  xtest('posts to channel', async ({ page }) => {
    await page.click('[data-testid="compose-cast"]');
    
    // Select channel
    await page.click('[data-testid="channel-selector"]');
    await page.click('[data-testid="channel-jeju"]');
    
    const testText = `Channel post ${Date.now()}`;
    await page.fill('[data-testid="cast-input"]', testText);
    await page.click('[data-testid="post-cast"]');
    
    await expect(page.locator('[data-testid="cast-success"]')).toBeVisible();
  });
});
```

### 4. Reactions Tests

File: `packages/farcaster/tests/e2e/reactions.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_FID } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Farcaster Reactions', () => {
  xtest.beforeEach(async ({ page }) => {
    await page.goto('/test/farcaster');
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
  });
  
  xtest('likes a cast', async ({ page }) => {
    // Get a cast to like
    const castHash = await page.evaluate(() => {
      return window.testHelpers.getRecentCastHash();
    });
    
    // Click like
    await page.click(`[data-testid="like-${castHash}"]`);
    
    // Verify like is reflected
    await expect(page.locator(`[data-testid="like-${castHash}"]`)).toHaveClass(/liked/);
  });
  
  xtest('unlikes a cast', async ({ page }) => {
    // Like first
    const castHash = await page.evaluate(() => {
      return window.testHelpers.getRecentCastHash();
    });
    
    await page.click(`[data-testid="like-${castHash}"]`);
    await expect(page.locator(`[data-testid="like-${castHash}"]`)).toHaveClass(/liked/);
    
    // Unlike
    await page.click(`[data-testid="like-${castHash}"]`);
    await expect(page.locator(`[data-testid="like-${castHash}"]`)).not.toHaveClass(/liked/);
  });
  
  xtest('recasts a cast', async ({ page }) => {
    const castHash = await page.evaluate(() => {
      return window.testHelpers.getRecentCastHash();
    });
    
    await page.click(`[data-testid="recast-${castHash}"]`);
    
    await expect(page.locator(`[data-testid="recast-${castHash}"]`)).toHaveClass(/recasted/);
  });
});
```

### 5. Follow Tests

File: `packages/farcaster/tests/e2e/follows.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_FID } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Farcaster Follows', () => {
  xtest.beforeEach(async ({ page }) => {
    await page.goto('/test/farcaster');
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
  });
  
  xtest('follows a user', async ({ page }) => {
    // Navigate to user profile
    await page.goto('/test/farcaster/profile/1'); // FID 1 = @v
    
    // Click follow
    await page.click('[data-testid="follow-button"]');
    
    // Verify following
    await expect(page.locator('[data-testid="follow-button"]')).toHaveText('Following');
  });
  
  xtest('unfollows a user', async ({ page }) => {
    // Navigate to a followed user
    await page.goto('/test/farcaster/profile/1');
    
    // Ensure we're following
    if (await page.locator('[data-testid="follow-button"]:has-text("Follow")').isVisible()) {
      await page.click('[data-testid="follow-button"]');
    }
    
    // Click unfollow
    await page.click('[data-testid="follow-button"]');
    await page.click('[data-testid="confirm-unfollow"]');
    
    // Verify unfollowed
    await expect(page.locator('[data-testid="follow-button"]')).toHaveText('Follow');
  });
  
  xtest('shows follower/following counts', async ({ page }) => {
    await page.goto('/test/farcaster/profile/1');
    
    await expect(page.locator('[data-testid="follower-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="following-count"]')).toBeVisible();
  });
});
```

### 6. Frame Tests

File: `packages/farcaster/tests/e2e/frames.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_FID } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Farcaster Frames', () => {
  xtest('renders frame in cast', async ({ page }) => {
    await page.goto('/test/farcaster');
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
    
    // Navigate to cast with frame
    await page.goto('/test/farcaster/cast/frame-test');
    
    // Verify frame is rendered
    await expect(page.locator('[data-testid="frame-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="frame-image"]')).toBeVisible();
    await expect(page.locator('[data-testid="frame-button-1"]')).toBeVisible();
  });
  
  xtest('handles frame button click', async ({ page }) => {
    await page.goto('/test/farcaster');
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
    
    await page.goto('/test/farcaster/cast/frame-test');
    
    // Click frame button
    await page.click('[data-testid="frame-button-1"]');
    
    // Verify frame updated
    await expect(page.locator('[data-testid="frame-container"]')).toHaveAttribute('data-state', 'updated');
  });
  
  xtest('handles transaction frame', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/farcaster');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    
    await page.evaluate((fid) => {
      window.testHelpers.simulateFarcasterAuth(fid);
    }, TEST_FID);
    
    // Navigate to tx frame
    await page.goto('/test/farcaster/cast/tx-frame');
    
    // Click tx button
    await page.click('[data-testid="frame-button-tx"]');
    
    // Confirm transaction in MetaMask
    await metamask.confirmTransaction();
    
    // Verify tx success
    await expect(page.locator('[data-testid="frame-tx-success"]')).toBeVisible();
  });
});
```

### 7. Playwright Config

File: `packages/farcaster/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: process.env.TEST_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

## Acceptance Criteria

- [ ] Auth tests pass
- [ ] Posting tests pass
- [ ] Reaction tests pass
- [ ] Follow tests pass
- [ ] Frame tests pass
- [ ] Tests run in CI
- [ ] Test results reported

## Output Files

1. `packages/farcaster/tests/e2e/setup.ts`
2. `packages/farcaster/tests/e2e/auth.test.ts`
3. `packages/farcaster/tests/e2e/posting.test.ts`
4. `packages/farcaster/tests/e2e/reactions.test.ts`
5. `packages/farcaster/tests/e2e/follows.test.ts`
6. `packages/farcaster/tests/e2e/frames.test.ts`
7. `packages/farcaster/playwright.config.ts`

## Commands

```bash
cd packages/farcaster

# Install dependencies
bun add -D @synthetixio/synpress @playwright/test

# Run all e2e tests
bun test:e2e

# Run specific test
bun test:e2e posting.test.ts

# Run with UI
bun test:e2e --ui
```

