# Agent Task: E2E Tests for XMTP Messaging Flows

## Priority: P1
## Estimated Time: 2 days
## Dependencies: All XMTP agents

## Objective

Create comprehensive end-to-end tests for all XMTP messaging functionality using Synpress for wallet interactions and real XMTP network calls.

## Source Files to Analyze

- `packages/messaging/src/tests/` - Existing tests
- `packages/sdk/src/messaging/` - Messaging module
- Synpress setup in existing apps

## Implementation Tasks

### 1. Test Setup

File: `packages/messaging/tests/e2e/setup.ts`

```typescript
import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

export const TEST_SEED = 'test test test test test test test test test test test junk';
export const TEST_PASSWORD = 'TestPassword123';

// Wallet setup for messaging tests
export default defineWalletSetup(TEST_PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, TEST_PASSWORD);
  await metamask.importWallet(TEST_SEED);
  
  // Add Jeju network
  await metamask.addNetwork({
    name: 'Jeju Testnet',
    rpcUrl: 'https://rpc.testnet.jeju.network',
    chainId: 420691,
    symbol: 'JEJU',
  });
  
  await metamask.switchNetwork('Jeju Testnet');
});

// Test accounts derived from seed
export const TEST_ACCOUNTS = {
  alice: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  bob: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  charlie: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
};
```

### 2. DM Tests

File: `packages/messaging/tests/e2e/dm.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_ACCOUNTS } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('XMTP DM Messaging', () => {
  xtest('initializes XMTP client with wallet signature', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    // Navigate to messaging test page
    await page.goto('/test/messaging');
    
    // Click connect wallet
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    
    // Click enable messaging
    await page.click('[data-testid="enable-messaging"]');
    
    // Sign XMTP identity creation message
    await metamask.confirmSignatureRequest();
    
    // Verify messaging is enabled
    await expect(page.locator('[data-testid="messaging-status"]')).toHaveText('Connected');
  });
  
  xtest('sends DM to another user', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    
    // Connect and enable messaging
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Start new conversation
    await page.fill('[data-testid="recipient-address"]', TEST_ACCOUNTS.bob.address);
    await page.click('[data-testid="start-conversation"]');
    
    // Send message
    const testMessage = `Test message ${Date.now()}`;
    await page.fill('[data-testid="message-input"]', testMessage);
    await page.click('[data-testid="send-message"]');
    
    // Verify message appears
    await expect(page.locator('[data-testid="message-list"]')).toContainText(testMessage);
  });
  
  xtest('receives DM from another user', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    
    // Connect as Alice
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Bob sends message via API (simulated)
    const testMessage = `Incoming message ${Date.now()}`;
    await page.evaluate(async ({ bobAddress, message }) => {
      // Simulate Bob sending a message
      await window.testHelpers.simulateIncomingMessage(bobAddress, message);
    }, { bobAddress: TEST_ACCOUNTS.bob.address, message: testMessage });
    
    // Verify message appears
    await expect(page.locator('[data-testid="message-list"]')).toContainText(testMessage);
  });
});
```

### 3. Group Chat Tests

File: `packages/messaging/tests/e2e/group.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_ACCOUNTS } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('XMTP Group Messaging', () => {
  xtest('creates group with multiple members', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    
    // Connect and enable messaging
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Create group
    await page.click('[data-testid="create-group"]');
    await page.fill('[data-testid="group-name"]', 'Test Group');
    
    // Add members
    await page.fill('[data-testid="add-member-input"]', TEST_ACCOUNTS.bob.address);
    await page.click('[data-testid="add-member-button"]');
    await page.fill('[data-testid="add-member-input"]', TEST_ACCOUNTS.charlie.address);
    await page.click('[data-testid="add-member-button"]');
    
    // Submit
    await page.click('[data-testid="create-group-submit"]');
    
    // Verify group created
    await expect(page.locator('[data-testid="conversation-list"]')).toContainText('Test Group');
    await expect(page.locator('[data-testid="group-members"]')).toContainText('3 members');
  });
  
  xtest('sends message to group', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    // Setup: Create group first (or use existing)
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Open existing group or create new
    await page.click('[data-testid="group-conversation"]');
    
    // Send message
    const testMessage = `Group message ${Date.now()}`;
    await page.fill('[data-testid="message-input"]', testMessage);
    await page.click('[data-testid="send-message"]');
    
    // Verify message appears
    await expect(page.locator('[data-testid="message-list"]')).toContainText(testMessage);
  });
  
  xtest('adds member to group', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Open group settings
    await page.click('[data-testid="group-conversation"]');
    await page.click('[data-testid="group-settings"]');
    
    // Add new member
    const newMember = '0x1234567890123456789012345678901234567890';
    await page.fill('[data-testid="add-member-input"]', newMember);
    await page.click('[data-testid="add-member-button"]');
    
    // Verify member added
    await expect(page.locator('[data-testid="group-members"]')).toContainText(newMember.slice(0, 6));
  });
  
  xtest('removes member from group', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Open group settings
    await page.click('[data-testid="group-conversation"]');
    await page.click('[data-testid="group-settings"]');
    
    // Remove member (Bob)
    await page.click(`[data-testid="remove-member-${TEST_ACCOUNTS.bob.address}"]`);
    await page.click('[data-testid="confirm-remove"]');
    
    // Verify member removed
    await expect(page.locator('[data-testid="group-members"]')).not.toContainText(TEST_ACCOUNTS.bob.address.slice(0, 6));
  });
});
```

### 4. Consent Tests

File: `packages/messaging/tests/e2e/consent.test.ts`

```typescript
import { test, expect } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import walletSetup, { TEST_ACCOUNTS } from './setup';

const xtest = testWithSynpress(metaMaskFixtures(walletSetup));

xtest.describe('Consent Management', () => {
  xtest('blocks sender on-chain', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Go to settings
    await page.click('[data-testid="messaging-settings"]');
    
    // Block an address
    await page.fill('[data-testid="block-address-input"]', TEST_ACCOUNTS.charlie.address);
    await page.click('[data-testid="block-address-button"]');
    
    // Confirm on-chain transaction
    await metamask.confirmTransaction();
    
    // Verify address is blocked
    await expect(page.locator('[data-testid="blocked-list"]')).toContainText(TEST_ACCOUNTS.charlie.address.slice(0, 6));
  });
  
  xtest('allows blocked sender', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Go to settings
    await page.click('[data-testid="messaging-settings"]');
    
    // Unblock address
    await page.click(`[data-testid="unblock-${TEST_ACCOUNTS.charlie.address}"]`);
    
    // Confirm on-chain transaction
    await metamask.confirmTransaction();
    
    // Verify address is not in blocked list
    await expect(page.locator('[data-testid="blocked-list"]')).not.toContainText(TEST_ACCOUNTS.charlie.address.slice(0, 6));
  });
  
  xtest('rejects messages from blocked sender', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletSetup.walletPassword, extensionId);
    
    await page.goto('/test/messaging');
    await page.click('[data-testid="connect-wallet"]');
    await metamask.connectToDapp();
    await page.click('[data-testid="enable-messaging"]');
    await metamask.confirmSignatureRequest();
    
    // Block Charlie
    await page.click('[data-testid="messaging-settings"]');
    await page.fill('[data-testid="block-address-input"]', TEST_ACCOUNTS.charlie.address);
    await page.click('[data-testid="block-address-button"]');
    await metamask.confirmTransaction();
    
    // Go back to messages
    await page.click('[data-testid="messaging-tab"]');
    
    // Simulate incoming message from blocked sender
    const response = await page.evaluate(async ({ address }) => {
      return window.testHelpers.simulateIncomingMessage(address, 'Blocked message');
    }, { address: TEST_ACCOUNTS.charlie.address });
    
    // Verify message was rejected
    expect(response.blocked).toBe(true);
    await expect(page.locator('[data-testid="message-list"]')).not.toContainText('Blocked message');
  });
});
```

### 5. Playwright Config

File: `packages/messaging/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Wallet tests need serial execution
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

- [ ] All DM tests pass
- [ ] All group tests pass
- [ ] Consent tests pass
- [ ] Tests run in CI
- [ ] Test results reported
- [ ] Wallet interactions work via Synpress

## Output Files

1. `packages/messaging/tests/e2e/setup.ts`
2. `packages/messaging/tests/e2e/dm.test.ts`
3. `packages/messaging/tests/e2e/group.test.ts`
4. `packages/messaging/tests/e2e/consent.test.ts`
5. `packages/messaging/playwright.config.ts`

## Commands

```bash
cd packages/messaging

# Install Synpress
bun add -D @synthetixio/synpress @playwright/test

# Run all e2e tests
bun test:e2e

# Run specific test file
bun test:e2e dm.test.ts

# Run with UI
bun test:e2e --ui
```

