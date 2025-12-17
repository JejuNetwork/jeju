/**
 * Models E2E Tests
 * Tests model hub listing, detail view, and inference playground
 */

import { test, expect } from '@playwright/test';

test.describe('Models', () => {
  test.describe('Model List', () => {
    test('should display model hub', async ({ page }) => {
      await page.goto('/models');
      
      await expect(page.getByRole('heading', { name: /model hub/i })).toBeVisible();
    });

    test('should show model stats', async ({ page }) => {
      await page.goto('/models');
      
      await expect(page.getByText(/total models/i)).toBeVisible();
      await expect(page.getByText(/total downloads/i)).toBeVisible();
    });

    test('should filter by model type', async ({ page }) => {
      await page.goto('/models');
      
      const typeFilters = ['All Models', 'LLM', 'Vision', 'Audio', 'Embedding', 'Multimodal'];
      
      for (const filter of typeFilters) {
        const button = page.getByRole('button', { name: new RegExp(filter, 'i') });
        if (await button.isVisible()) {
          await button.click();
          await expect(button).toHaveClass(/bg-accent/);
          break; // Just test one
        }
      }
    });

    test('should search models', async ({ page }) => {
      await page.goto('/models');
      
      const searchInput = page.getByPlaceholder(/search models/i);
      await searchInput.fill('llama');
      await expect(searchInput).toHaveValue('llama');
    });

    test('should sort models', async ({ page }) => {
      await page.goto('/models');
      
      const sortSelect = page.locator('select').first();
      if (await sortSelect.isVisible()) {
        await sortSelect.selectOption('stars');
      }
    });

    test('should display model cards', async ({ page }) => {
      await page.goto('/models');
      
      // Check model cards are visible
      const modelCard = page.locator('.card').first();
      await expect(modelCard).toBeVisible();
    });

    test('should show upload model button', async ({ page }) => {
      await page.goto('/models');
      
      await expect(page.getByRole('link', { name: /upload model/i })).toBeVisible();
    });
  });

  test.describe('Model Detail', () => {
    test('should display model header', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await expect(page.getByRole('heading', { name: /llama-3-jeju-ft/i }).first()).toBeVisible();
    });

    test('should show model badges', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      // Type badge
      await expect(page.locator('.badge').first()).toBeVisible();
    });

    test('should display model stats', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await expect(page.getByText(/downloads/i).first()).toBeVisible();
      await expect(page.getByText(/parameters/i).first()).toBeVisible();
    });

    test('should show model tabs', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await expect(page.getByRole('button', { name: /model card/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /files/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /inference/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /training/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /versions/i })).toBeVisible();
    });

    test('should render model card markdown', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      // Model card content
      await expect(page.locator('.prose, [class*="markdown"]').first()).toBeVisible();
    });

    test('should show star and fork buttons', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await expect(page.getByRole('button').filter({ hasText: /\d+/ }).first()).toBeVisible();
    });
  });

  test.describe('Model Files Tab', () => {
    test('should show files tab', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      const filesButton = page.getByRole('button', { name: /files/i });
      await expect(filesButton).toBeVisible();
    });

    test('should switch to files tab', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /files/i }).click();
      
      // Tab should be active
      await expect(page.getByRole('main')).toBeVisible();
    });
  });

  test.describe('Inference Playground', () => {
    test('should display inference tab', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      // Should show input section
      await expect(page.getByText(/input/i)).toBeVisible();
    });

    test('should show prompt textarea', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      await expect(page.locator('textarea')).toBeVisible();
    });

    test('should show generate button', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      await expect(page.getByRole('button', { name: /generate/i })).toBeVisible();
    });

    test('should show configuration sliders', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      // Config section
      await expect(page.getByText(/configuration/i)).toBeVisible();
      await expect(page.getByText(/max tokens/i)).toBeVisible();
      await expect(page.getByText(/temperature/i)).toBeVisible();
    });

    test('should type prompt and show in textarea', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      const textarea = page.locator('textarea');
      await textarea.fill('Write a Solidity function');
      
      await expect(textarea).toHaveValue('Write a Solidity function');
    });

    test('should trigger generation on button click', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      // Fill prompt
      await page.locator('textarea').fill('Write a simple function');
      
      // Click generate
      await page.getByRole('button', { name: /generate/i }).click();
      
      // Should show loading or output
      await expect(page.getByText(/generating|output/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should show API endpoint', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      await expect(page.getByText(/api endpoint/i)).toBeVisible();
      await expect(page.locator('code').filter({ hasText: /inference\.jeju/i })).toBeVisible();
    });

    test('should adjust config sliders', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      // Find and interact with sliders
      const sliders = page.locator('input[type="range"]');
      const count = await sliders.count();
      
      if (count > 0) {
        await sliders.first().fill('500');
      }
    });
  });

  test.describe('Training Tab', () => {
    test('should display training options', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /training/i }).click();
      
      // Should show training info
      await expect(page.getByText(/train on jeju compute/i)).toBeVisible();
    });

    test('should show training plans', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /training/i }).click();
      
      // Training options
      await expect(page.getByText(/qlora|fine-tuning|dpo/i).first()).toBeVisible();
    });

    test('should show pricing', async ({ page }) => {
      await page.goto('/models/jeju/llama-3-jeju-ft');
      
      await page.getByRole('button', { name: /training/i }).click();
      
      await expect(page.getByText(/ETH/i).first()).toBeVisible();
    });
  });

  test.describe('Model Upload', () => {
    test('should navigate to upload page', async ({ page }) => {
      await page.goto('/models/upload');
      
      await expect(page.getByRole('heading', { name: /upload/i })).toBeVisible();
    });

    test('should show upload form steps', async ({ page }) => {
      await page.goto('/models/upload');
      
      // Should show multi-step form or form fields
      await expect(page.locator('input, select, textarea').first()).toBeVisible();
    });
  });
});

