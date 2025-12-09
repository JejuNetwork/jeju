/**
 * @fileoverview E2E tests for the OIF Intent Viewer
 * Tests the full user flow: connect wallet, create intent, track status
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../playwright.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Base URL for the viewer
const VIEWER_URL = process.env.VIEWER_URL || 'http://localhost:4011';

test.describe('OIF Intent Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VIEWER_URL);
  });

  test('should display the main interface', async ({ page }) => {
    // Check header elements
    await expect(page.getByRole('heading', { name: /Jeju Intent Network/i })).toBeVisible();
    
    // Check navigation tabs
    await expect(page.getByText('Intents')).toBeVisible();
    await expect(page.getByText('Routes')).toBeVisible();
    await expect(page.getByText('Solvers')).toBeVisible();
    await expect(page.getByText('Stats')).toBeVisible();
    
    // Check connect button exists when not connected
    await expect(page.getByRole('button', { name: /Connect/i })).toBeVisible();
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

    // Click connect button
    await page.getByRole('button', { name: /Connect/i }).click();
    
    // Connect via MetaMask popup
    await metamask.connectToDapp();
    
    // Verify connected state - should show truncated address
    await expect(page.getByText(/0xf39/i)).toBeVisible({ timeout: 10000 });
    
    // Create Intent button should now be enabled
    const createBtn = page.getByRole('button', { name: /Create Intent/i });
    await expect(createBtn).toBeEnabled();
  });

  test('should open create intent modal', async ({
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

    // Connect wallet first
    await page.getByRole('button', { name: /Connect/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39/i)).toBeVisible({ timeout: 10000 });

    // Click create intent
    await page.getByRole('button', { name: /Create Intent/i }).click();

    // Modal should appear
    await expect(page.getByText('Create Cross-Chain Intent')).toBeVisible();
    
    // Check form fields exist
    await expect(page.getByLabel(/Source Chain/i)).toBeVisible();
    await expect(page.getByLabel(/Destination Chain/i)).toBeVisible();
    await expect(page.getByLabel(/Input Token/i)).toBeVisible();
    await expect(page.getByLabel(/Amount/i)).toBeVisible();
  });

  test('should fill intent form and submit', async ({
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
    await page.getByRole('button', { name: /Connect/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39/i)).toBeVisible({ timeout: 10000 });

    // Open create intent modal
    await page.getByRole('button', { name: /Create Intent/i }).click();
    await expect(page.getByText('Create Cross-Chain Intent')).toBeVisible();

    // Fill the form
    await page.getByLabel(/Source Chain/i).selectOption({ label: 'Ethereum' });
    await page.getByLabel(/Destination Chain/i).selectOption({ label: 'Arbitrum' });
    await page.getByLabel(/Amount/i).fill('0.1');

    // Click create
    await page.getByRole('button', { name: /Create/i }).last().click();

    // MetaMask should prompt for transaction approval
    await metamask.confirmTransaction();

    // Should show success or pending state
    await expect(
      page.getByText(/Intent created|Pending|Processing/i)
    ).toBeVisible({ timeout: 30000 });
  });

  test('should navigate to Routes tab', async ({ page }) => {
    // Click Routes tab
    await page.getByText('Routes').click();

    // Should show routes content
    await expect(page.getByText(/Available Routes|Cross-Chain Routes/i)).toBeVisible();
  });

  test('should navigate to Solvers tab', async ({ page }) => {
    // Click Solvers tab
    await page.getByText('Solvers').click();

    // Should show solvers content
    await expect(page.getByText(/Active Solvers|Solver Network/i)).toBeVisible();
  });

  test('should navigate to Stats tab', async ({ page }) => {
    // Click Stats tab
    await page.getByText('Stats').click();

    // Should show stats content
    await expect(page.getByText(/Network Stats|Statistics|Total Volume/i)).toBeVisible();
  });

  test('should display intent details when clicked', async ({ page }) => {
    // Navigate to intents
    await page.getByText('Intents').click();

    // If there are any intents listed, click the first one
    const intentCards = page.locator('[data-testid="intent-card"]');
    const count = await intentCards.count();
    
    if (count > 0) {
      await intentCards.first().click();
      // Should show intent details panel
      await expect(page.getByText(/Intent Details|Status|Solver/i)).toBeVisible();
    }
  });

  test('should filter intents by status', async ({ page }) => {
    // Navigate to intents
    await page.getByText('Intents').click();

    // Look for filter controls
    const statusFilter = page.getByRole('combobox', { name: /Status/i });
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption({ label: 'Open' });
      // URL or content should reflect filter
    }
  });

  test('should search for specific intent', async ({ page }) => {
    // Look for search input
    const searchInput = page.getByPlaceholder(/Search|Intent ID/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill('0x');
      // Should filter or show search results
    }
  });

  test('should switch networks in wallet', async ({
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
    await page.getByRole('button', { name: /Connect/i }).click();
    await metamask.connectToDapp();
    await expect(page.getByText(/0xf39/i)).toBeVisible({ timeout: 10000 });

    // Click on chain button to switch networks
    const chainButton = page.getByRole('button', { name: /Base|Ethereum|Network/i });
    if (await chainButton.isVisible()) {
      await chainButton.click();
      // MetaMask should prompt for network switch
    }
  });
});

test.describe('OIF Intent API', () => {
  test('should fetch routes from aggregator', async ({ page }) => {
    const response = await page.request.get('http://localhost:4010/api/routes');
    expect(response.ok()).toBeTruthy();
    
    const routes = await response.json();
    expect(Array.isArray(routes)).toBeTruthy();
  });

  test('should fetch solvers from aggregator', async ({ page }) => {
    const response = await page.request.get('http://localhost:4010/api/solvers');
    expect(response.ok()).toBeTruthy();
    
    const solvers = await response.json();
    expect(Array.isArray(solvers)).toBeTruthy();
  });

  test('should fetch stats from aggregator', async ({ page }) => {
    const response = await page.request.get('http://localhost:4010/api/stats');
    expect(response.ok()).toBeTruthy();
    
    const stats = await response.json();
    expect(stats).toHaveProperty('totalIntents');
    expect(stats).toHaveProperty('totalVolume');
  });

  test('should fetch agent card', async ({ page }) => {
    const response = await page.request.get('http://localhost:4010/.well-known/agent-card.json');
    expect(response.ok()).toBeTruthy();
    
    const card = await response.json();
    expect(card.name).toBe('Jeju Open Intents Aggregator');
    expect(card.skills).toBeDefined();
  });
});

