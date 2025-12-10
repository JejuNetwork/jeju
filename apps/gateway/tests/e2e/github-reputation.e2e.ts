import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('GitHub Reputation Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display GitHub reputation panel when connected', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    // Navigate to registry/agent page
    await page.goto('/registry');

    // Check for GitHub reputation panel
    await expect(page.locator('text=GitHub Reputation')).toBeVisible({ timeout: 10000 });
  });

  test('should show link GitHub option when wallet not linked', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    await page.goto('/registry');

    // Should show link option
    await expect(page.locator('text=Link GitHub Account')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Reduced staking requirements')).toBeVisible();
  });

  test('should open GitHub linking form', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    await page.goto('/registry');

    // Click link button
    await page.locator('text=Link GitHub Account').click();

    // Form should appear
    await expect(page.locator('input[placeholder="GitHub username"]')).toBeVisible();
    await expect(page.locator('text=Verify & Link')).toBeVisible();
  });

  test('should validate GitHub username input', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    await page.goto('/registry');

    // Click link button
    await page.locator('text=Link GitHub Account').click();

    // Verify button should be disabled with empty input
    const verifyButton = page.locator('text=Verify & Link');
    await expect(verifyButton).toBeDisabled();

    // Enter username
    await page.locator('input[placeholder="GitHub username"]').fill('testuser');

    // Button should be enabled
    await expect(verifyButton).toBeEnabled();
  });

  test('should cancel GitHub linking', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    await page.goto('/registry');

    // Click link button
    await page.locator('text=Link GitHub Account').click();

    // Click cancel
    await page.locator('text=Cancel').click();

    // Form should be hidden
    await expect(page.locator('input[placeholder="GitHub username"]')).not.toBeVisible();
  });

  test('should show reputation scores for linked accounts', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet  
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    // Navigate to a mocked endpoint that returns reputation data
    await page.route('**/api/attestation**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          username: 'testuser',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          wallet: {
            address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
            chainId: 'eip155:1',
            isVerified: true,
            verifiedAt: new Date().toISOString(),
          },
          reputation: {
            totalScore: 5000,
            normalizedScore: 65,
            prScore: 2000,
            issueScore: 1000,
            reviewScore: 1500,
            commitScore: 500,
            mergedPrCount: 25,
            totalPrCount: 30,
            totalCommits: 150,
          },
          attestation: null,
        }),
      });
    });

    await page.goto('/registry');

    // Should display user profile
    await expect(page.locator('text=testuser')).toBeVisible({ timeout: 10000 });

    // Should show score
    await expect(page.locator('text=65')).toBeVisible();
    await expect(page.locator('text=Score (0-100)')).toBeVisible();

    // Should show PR count
    await expect(page.locator('text=25')).toBeVisible();
    await expect(page.locator('text=Merged PRs')).toBeVisible();
  });

  test('should show request attestation button when no attestation exists', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    // Mock API response with no attestation
    await page.route('**/api/attestation**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          username: 'testuser',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          wallet: {
            address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
            chainId: 'eip155:1',
            isVerified: true,
            verifiedAt: new Date().toISOString(),
          },
          reputation: {
            totalScore: 5000,
            normalizedScore: 65,
            prScore: 2000,
            issueScore: 1000,
            reviewScore: 1500,
            commitScore: 500,
            mergedPrCount: 25,
            totalPrCount: 30,
            totalCommits: 150,
          },
          attestation: null,
        }),
      });
    });

    await page.goto('/registry');

    // Should show request attestation button
    await expect(page.locator('text=Request Attestation')).toBeVisible({ timeout: 10000 });
  });

  test('should display on-chain reputation boost status', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Connect wallet
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await metamask.connectToDapp();

    // Mock API response with attestation
    await page.route('**/api/attestation**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          username: 'testuser',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          wallet: {
            address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
            chainId: 'eip155:1',
            isVerified: true,
            verifiedAt: new Date().toISOString(),
          },
          reputation: {
            totalScore: 15000,
            normalizedScore: 75,
            prScore: 6000,
            issueScore: 3000,
            reviewScore: 4500,
            commitScore: 1500,
            mergedPrCount: 75,
            totalPrCount: 90,
            totalCommits: 450,
          },
          attestation: {
            hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            signature: '0xabc123',
            normalizedScore: 75,
            calculatedAt: new Date().toISOString(),
            attestedAt: new Date().toISOString(),
            agentId: 1,
            txHash: '0xdef456',
          },
        }),
      });
    });

    await page.goto('/registry');

    // Should show on-chain status section
    await expect(page.locator('text=On-Chain Status')).toBeVisible({ timeout: 10000 });
  });
});
