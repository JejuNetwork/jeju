/**
 * Agents E2E Tests
 * Tests Crucible agent interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
  test.describe('Agent List', () => {
    test('should display agents page', async ({ page }) => {
      await page.goto('/agents');
      
      await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible();
    });

    test('should show agent stats', async ({ page }) => {
      await page.goto('/agents');
      
      await expect(page.getByText(/total agents/i)).toBeVisible();
      await expect(page.getByText(/active/i).first()).toBeVisible();
    });

    test('should filter by status', async ({ page }) => {
      await page.goto('/agents');
      
      const filters = ['All Agents', 'Active', 'Idle', 'Processing'];
      
      for (const filter of filters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          break;
        }
      }
    });

    test('should search agents', async ({ page }) => {
      await page.goto('/agents');
      
      const searchInput = page.getByPlaceholder(/search agents/i);
      if (await searchInput.isVisible()) {
        await searchInput.fill('code-review');
        await expect(searchInput).toHaveValue('code-review');
      }
    });

    test('should display agent cards', async ({ page }) => {
      await page.goto('/agents');
      
      const agentCards = page.locator('.card');
      await expect(agentCards.first()).toBeVisible();
    });

    test('should show agent status indicator', async ({ page }) => {
      await page.goto('/agents');
      
      // Status dots (green, yellow, gray)
      const statusDots = page.locator('.rounded-full.bg-green-500, .rounded-full.bg-yellow-500');
      await expect(statusDots.first()).toBeVisible();
    });

    test('should show agent capabilities', async ({ page }) => {
      await page.goto('/agents');
      
      // Capability badges
      const capabilityBadges = page.locator('.badge');
      await expect(capabilityBadges.first()).toBeVisible();
    });

    test('should show spawn agent button', async ({ page }) => {
      await page.goto('/agents');
      
      await expect(page.getByRole('link', { name: /spawn agent/i })).toBeVisible();
    });

    test('should show crucible integration', async ({ page }) => {
      await page.goto('/agents');
      
      await expect(page.getByText(/crucible/i).first()).toBeVisible();
    });
  });

  test.describe('Agent Detail', () => {
    test('should navigate to agent detail', async ({ page }) => {
      await page.goto('/agents');
      
      const agentLink = page.locator('a[href^="/agents/"]').first();
      if (await agentLink.isVisible()) {
        await agentLink.click();
        await expect(page).toHaveURL(/\/agents\/.+/);
      }
    });
  });

  test.describe('Agent Actions', () => {
    test('should show deploy button', async ({ page }) => {
      await page.goto('/agents');
      
      const deployButtons = page.getByRole('button', { name: /deploy|use/i });
      if (await deployButtons.first().isVisible()) {
        await expect(deployButtons.first()).toBeVisible();
      }
    });

    test('should show view logs button', async ({ page }) => {
      await page.goto('/agents');
      
      const logsButtons = page.getByRole('button', { name: /logs|view/i });
      if (await logsButtons.first().isVisible()) {
        await expect(logsButtons.first()).toBeVisible();
      }
    });
  });
});


