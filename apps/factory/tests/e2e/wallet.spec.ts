/**
 * Wallet E2E Tests (Synpress)
 * Tests wallet connection, transactions, and on-chain verification
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Wallet Connection', () => {
  test('should show connect wallet button when disconnected', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  });

  test('should connect wallet via MetaMask', async ({
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

    await page.goto('/');
    
    // Click connect wallet
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    // Select MetaMask from wallet options
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    // Connect via MetaMask
    await metamask.connectToDapp();
    
    // Should show connected address
    await expect(page.getByText(/0x[a-f0-9]{4,}/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should show user menu when connected', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // User menu should be visible
    await expect(page.locator('button').filter({ has: page.locator('img.rounded-full') })).toBeVisible();
  });

  test('should disconnect wallet', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Click user menu
    await page.locator('button').filter({ has: page.locator('img.rounded-full') }).click();
    
    // Click disconnect
    await page.getByRole('button', { name: /disconnect/i }).click();
    
    // Should show connect button again
    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  });
});

test.describe('Bounty Transactions', () => {
  test('should create bounty with on-chain transaction', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to create bounty
    await page.goto('/bounties/new');
    
    // Fill bounty form
    await page.getByLabel(/title/i).fill('E2E Test Bounty');
    await page.getByLabel(/description/i).fill('This is a test bounty created by E2E tests');
    await page.getByLabel(/reward/i).fill('0.01');
    
    // Submit
    await page.getByRole('button', { name: /create bounty/i }).click();
    
    // Approve transaction in MetaMask
    await metamask.confirmTransaction();
    
    // Should redirect to bounty detail
    await expect(page).toHaveURL(/\/bounties\/\d+/, { timeout: 30000 });
    
    // Verify bounty created
    await expect(page.getByText('E2E Test Bounty')).toBeVisible();
  });

  test('should apply to bounty', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to bounty
    await page.goto('/bounties/1');
    
    // Click apply
    await page.getByRole('button', { name: /apply/i }).click();
    
    // Fill application
    await page.getByLabel(/proposal/i).fill('I can complete this bounty within the deadline');
    
    // Submit application
    await page.getByRole('button', { name: /submit application/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should show success
    await expect(page.getByText(/application submitted/i)).toBeVisible({ timeout: 30000 });
  });

  test('should submit bounty work', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to assigned bounty
    await page.goto('/bounties/1');
    
    // Click submit work
    await page.getByRole('button', { name: /submit work/i }).click();
    
    // Fill submission
    await page.getByLabel(/submission url/i).fill('https://github.com/jeju/test-submission');
    await page.getByLabel(/description/i).fill('Work completed as per requirements');
    
    // Submit
    await page.getByRole('button', { name: /submit/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should show pending review status
    await expect(page.getByText(/pending review/i)).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Guardian Actions', () => {
  test('should register as guardian', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to guardians page
    await page.goto('/guardians');
    
    // Click register
    await page.getByRole('button', { name: /register as guardian/i }).click();
    
    // Fill guardian application
    await page.getByLabel(/stake amount/i).fill('0.1');
    await page.getByLabel(/specializations/i).fill('smart contracts, security');
    
    // Submit
    await page.getByRole('button', { name: /stake and register/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should show registered status
    await expect(page.getByText(/guardian registered/i)).toBeVisible({ timeout: 30000 });
  });

  test('should review and approve submission', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to bounty as guardian
    await page.goto('/bounties/1');
    
    // Click review
    await page.getByRole('button', { name: /review submission/i }).click();
    
    // Approve
    await page.getByRole('button', { name: /approve/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should show approved
    await expect(page.getByText(/approved/i)).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Model Registration', () => {
  test('should register model on-chain', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to model upload
    await page.goto('/models/upload');
    
    // Fill model info
    await page.getByLabel(/name/i).fill('test-model');
    await page.getByLabel(/model type/i).selectOption('llm');
    await page.getByLabel(/description/i).fill('Test model for E2E');
    
    // Submit
    await page.getByRole('button', { name: /register model/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should redirect to model page
    await expect(page).toHaveURL(/\/models\/\w+\/test-model/, { timeout: 30000 });
  });
});

test.describe('Container Registration', () => {
  test('should register container on-chain', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to container push
    await page.goto('/containers/push');
    
    // Fill container info
    await page.getByLabel(/name/i).fill('test-container');
    await page.getByLabel(/tag/i).fill('latest');
    await page.getByLabel(/architectures/i).check();
    
    // Submit
    await page.getByRole('button', { name: /register container/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should redirect to container page
    await expect(page).toHaveURL(/\/containers\/\w+\/test-container/, { timeout: 30000 });
  });
});

test.describe('Project Board Transactions', () => {
  test('should create project on-chain', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to create project
    await page.goto('/projects/new');
    
    // Fill project info
    await page.getByLabel(/name/i).fill('E2E Test Project');
    await page.getByLabel(/description/i).fill('Test project for E2E');
    
    // Submit
    await page.getByRole('button', { name: /create project/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Should redirect to project
    await expect(page).toHaveURL(/\/projects\/\d+/, { timeout: 30000 });
  });

  test('should add task to project', async ({
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

    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    
    const metamaskOption = page.getByText(/metamask/i);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }
    
    await metamask.connectToDapp();
    
    // Navigate to project
    await page.goto('/projects/1');
    
    // Add task
    await page.getByRole('button', { name: /add task/i }).click();
    
    // Fill task info
    await page.getByLabel(/title/i).fill('E2E Test Task');
    await page.getByLabel(/description/i).fill('Test task created by E2E');
    
    // Submit
    await page.getByRole('button', { name: /create task/i }).click();
    
    // Approve transaction
    await metamask.confirmTransaction();
    
    // Task should appear
    await expect(page.getByText('E2E Test Task')).toBeVisible({ timeout: 30000 });
  });
});

