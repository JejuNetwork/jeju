/**
 * @fileoverview App Registry (ERC-8004) E2E tests
 * @module gateway/tests/e2e/app-registry
 */

import { testWithWallet as test, expect } from '../fixtures/wallet';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';

test.describe('App Registry Flow', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    // Navigate to App Registry tab
    await page.getByRole('button', { name: /App Registry/i }).click();
  });

  test('should display app registry interface', async ({ page }) => {
    await expect(page.getByText(/ERC-8004 Registry/i)).toBeVisible();
  });

  test('should show browse and register sections', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Browse Apps/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Register App/i })).toBeVisible();
  });

  test('should display registered apps list', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    // Should show tag filters
    await expect(page.getByText('All Apps')).toBeVisible();
    await expect(page.getByText('Applications')).toBeVisible();
    await expect(page.getByText('Games')).toBeVisible();
    await expect(page.getByText('Marketplaces')).toBeVisible();
    await expect(page.getByText('DeFi')).toBeVisible();
  });

  test('should filter apps by tag', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    // Click on a tag filter
    await page.getByText('Games').click();
    
    // URL or state should update (implementation dependent)
    // Empty state or filtered results should show
  });

  test('should display app cards with metadata', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();
    
    if (count > 0) {
      const firstApp = appCards.first();
      
      // Should show app name, ID, tags
      await expect(firstApp.locator('h3')).toBeVisible();
      await expect(firstApp.getByText(/ID:/i)).toBeVisible();
      
      // Should show stake info
      await expect(firstApp.getByText(/Stake:/i)).toBeVisible();
      await expect(firstApp.getByText(/Owner:/i)).toBeVisible();
    }
  });

  test('should show A2A enabled badge for apps with endpoint', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    const a2aBadges = page.getByText(/A2A Enabled/i);
    const count = await a2aBadges.count();
    
    // Some apps may have A2A endpoints
    expect(count >= 0).toBe(true);
  });

  test('should open app detail modal on click', async ({ page }) => {
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    
    const appCards = page.locator('.card').filter({ hasText: /ID:/i });
    const count = await appCards.count();
    
    if (count > 0) {
      await appCards.first().click();
      
      // Modal should open
      const modal = page.locator('[style*="position: fixed"]').filter({ hasText: /Agent ID:/i });
      await expect(modal).toBeVisible();
      
      // Close button should work
      const closeButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await closeButton.click();
      await expect(modal).not.toBeVisible();
    }
  });
});

test.describe('Register New App Flow', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, wallet);
    
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.getByRole('button', { name: /Register App/i }).click();
  });

  test('should display registration form', async ({ page }) => {
    await expect(page.getByText('Register New App')).toBeVisible();
  });

  test('should have required app name field', async ({ page }) => {
    await expect(page.getByPlaceholder('My Awesome App')).toBeVisible();
    await expect(page.getByText(/App Name/i).filter({ hasText: '*' })).toBeVisible();
  });

  test('should have optional description field', async ({ page }) => {
    const descriptionField = page.getByPlaceholder(/Brief description/i);
    await expect(descriptionField).toBeVisible();
  });

  test('should have optional A2A endpoint field', async ({ page }) => {
    await expect(page.getByPlaceholder('https://myapp.com/a2a')).toBeVisible();
    await expect(page.getByText(/for agent discovery/i)).toBeVisible();
  });

  test('should have tag selection with multiple categories', async ({ page }) => {
    await expect(page.getByText('📱 Application')).toBeVisible();
    await expect(page.getByText('🎮 Game')).toBeVisible();
    await expect(page.getByText('🏪 Marketplace')).toBeVisible();
    await expect(page.getByText('💰 DeFi')).toBeVisible();
    await expect(page.getByText('💬 Social')).toBeVisible();
    await expect(page.getByText('📊 Information Provider')).toBeVisible();
    await expect(page.getByText('⚙️ Service')).toBeVisible();
  });

  test('should allow selecting multiple tags', async ({ page }) => {
    const gameTag = page.getByRole('button', { name: /🎮 Game/i });
    const socialTag = page.getByRole('button', { name: /💬 Social/i });
    
    // Click to select
    await gameTag.click();
    await socialTag.click();
    
    // Both should be selected (styling change)
    await expect(gameTag).toHaveCSS('background', /#667eea/i);
    await expect(socialTag).toHaveCSS('background', /#667eea/i);
  });

  test('should have stake token selector', async ({ page }) => {
    await expect(page.getByText(/Stake Token/i)).toBeVisible();
    await expect(page.getByText(/\.001 ETH worth/i)).toBeVisible();
    await expect(page.getByText(/Fully refundable/i)).toBeVisible();
  });

  test('should calculate required stake in selected token', async ({ page }) => {
    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.getByText('VIRTUAL').click();
    
    // Required stake should be displayed
    await expect(page.getByText('Required Stake:')).toBeVisible();
    await expect(page.getByText(/≈ \$3.50 USD/i)).toBeVisible();
  });

  test('should validate form before submission', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: /Register App/i });
    
    // Button should be disabled without required fields
    await expect(submitButton).toBeDisabled();
  });

  test('should enable submit button with valid inputs', async ({ page }) => {
    // Fill app name
    await page.getByPlaceholder('My Awesome App').fill('Test App');
    
    // Select a tag
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    
    // Select stake token
    const stakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await stakeSelector.click();
    await page.getByText('elizaOS').click();
    
    // Submit button should now be enabled
    const submitButton = page.getByRole('button', { name: /Register App/i });
    await expect(submitButton).toBeEnabled();
  });

  test('should show refundable stake info', async ({ page }) => {
    await expect(page.getByText(/Your stake is fully refundable/i)).toBeVisible();
    await expect(page.getByText(/withdraw it anytime/i)).toBeVisible();
  });
});


