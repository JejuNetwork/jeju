/**
 * Mobile Responsiveness E2E Tests
 * Tests mobile-specific UI behaviors and interactions
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Mobile viewport
test.use({ viewport: { width: 375, height: 667 } });

test.describe('Mobile Layout', () => {
  test('should show mobile header', async ({ page }) => {
    await page.goto('/');
    
    // Mobile menu button should be visible
    const menuButton = page.locator('header button').first();
    await expect(menuButton).toBeVisible();
    
    // Jeju branding should be in header
    await expect(page.locator('header').locator('text=Jeju')).toBeVisible();
  });

  test('should hide sidebar by default on mobile', async ({ page }) => {
    await page.goto('/');
    
    // Sidebar should be hidden (translated off-screen)
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/-translate-x-full/);
  });

  test('should open sidebar when clicking menu button', async ({ page }) => {
    await page.goto('/');
    
    // Click menu button
    const menuButton = page.locator('header button').first();
    await menuButton.click();
    
    // Sidebar should be visible
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/translate-x-0/);
    
    // Navigation should be visible
    await expect(page.locator('button:has-text("Chat")')).toBeVisible();
    await expect(page.locator('button:has-text("Portfolio")')).toBeVisible();
  });

  test('should close sidebar when clicking overlay', async ({ page }) => {
    await page.goto('/');
    
    // Open sidebar
    const menuButton = page.locator('header button').first();
    await menuButton.click();
    await page.waitForTimeout(200);
    
    // Click overlay
    const overlay = page.locator('.bg-black\\/50');
    await overlay.click();
    
    // Sidebar should be hidden again
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/-translate-x-full/);
  });

  test('should close sidebar when clicking X button', async ({ page }) => {
    await page.goto('/');
    
    // Open sidebar
    const menuButton = page.locator('header button').first();
    await menuButton.click();
    await page.waitForTimeout(200);
    
    // Click X button in sidebar
    const closeButton = page.locator('aside button').filter({ has: page.locator('svg.lucide-x') });
    await closeButton.click();
    
    // Sidebar should be hidden
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/-translate-x-full/);
  });
});

test.describe('Mobile Chat', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    // Open sidebar and connect
    const menuButton = page.locator('header button').first();
    await menuButton.click();
    await page.waitForTimeout(200);
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
    
    // Close sidebar
    const overlay = page.locator('.bg-black\\/50');
    if (await overlay.isVisible()) {
      await overlay.click();
    }
  });

  test('should show chat input on mobile', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await expect(chatInput).toBeVisible();
  });

  test('should allow typing on mobile', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('Hello');
    await expect(chatInput).toHaveValue('Hello');
  });

  test('should show quick action buttons on mobile', async ({ page }) => {
    await expect(page.locator('button:has-text("My Portfolio")')).toBeVisible();
  });
});

test.describe('Mobile Portfolio', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    // Open sidebar and connect
    const menuButton = page.locator('header button').first();
    await menuButton.click();
    await page.waitForTimeout(200);
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should navigate to portfolio from sidebar', async ({ page }) => {
    // Click portfolio in sidebar
    const portfolioButton = page.locator('button:has-text("Portfolio")');
    await portfolioButton.click();
    
    // Close sidebar
    const overlay = page.locator('.bg-black\\/50');
    if (await overlay.isVisible()) {
      await overlay.click();
      await page.waitForTimeout(200);
    }
    
    // Should show portfolio content
    await expect(page.locator('text=Unified Portfolio')).toBeVisible();
  });

  test('should show portfolio value card on mobile', async ({ page }) => {
    // Navigate to portfolio
    const portfolioButton = page.locator('button:has-text("Portfolio")');
    await portfolioButton.click();
    
    const overlay = page.locator('.bg-black\\/50');
    if (await overlay.isVisible()) {
      await overlay.click();
    }
    
    await expect(page.locator('text=Total Portfolio Value')).toBeVisible();
  });
});

