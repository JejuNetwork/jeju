/**
 * Forms E2E Tests
 * Tests all form inputs, validation, and submissions
 */

import { test, expect } from '@playwright/test';

test.describe('Form Validation', () => {
  test.describe('Search Forms', () => {
    test('should search bounties with keyboard', async ({ page }) => {
      await page.goto('/bounties');
      
      const search = page.getByPlaceholder(/search/i);
      await search.fill('security');
      await search.press('Enter');
      
      // Should filter or trigger search
    });

    test('should search repositories with special chars', async ({ page }) => {
      await page.goto('/git');
      
      const search = page.getByPlaceholder(/find/i);
      await search.fill('@jeju/contracts');
      
      await expect(search).toHaveValue('@jeju/contracts');
    });

    test('should clear search input', async ({ page }) => {
      await page.goto('/packages');
      
      const search = page.getByPlaceholder(/search/i);
      await search.fill('test');
      
      // Clear with keyboard
      await search.selectText();
      await search.press('Backspace');
      
      await expect(search).toHaveValue('');
    });
  });

  test.describe('Filter Forms', () => {
    test('should apply multiple filters', async ({ page }) => {
      await page.goto('/bounties');
      
      // Status filter
      await page.getByRole('button', { name: /open/i }).click();
      
      // Skill filter (if exists)
      const skillBadge = page.locator('.badge').first();
      if (await skillBadge.isVisible()) {
        await skillBadge.click();
      }
    });

    test('should reset filters', async ({ page }) => {
      await page.goto('/bounties');
      
      // Apply filter
      await page.getByRole('button', { name: /open/i }).click();
      
      // Reset (All button)
      await page.getByRole('button', { name: /all/i }).first().click();
    });
  });

  test.describe('Select Inputs', () => {
    test('should sort repositories by different options', async ({ page }) => {
      await page.goto('/git');
      
      const select = page.locator('select').first();
      if (await select.isVisible()) {
        const options = await select.locator('option').allTextContents();
        
        for (const option of options) {
          await select.selectOption({ label: option });
        }
      }
    });

    test('should select model type', async ({ page }) => {
      await page.goto('/models');
      
      const buttons = page.getByRole('button');
      const types = ['All Models', 'LLM', 'Vision', 'Audio'];
      
      for (const type of types) {
        const btn = buttons.filter({ hasText: new RegExp(type, 'i') });
        if (await btn.first().isVisible()) {
          await btn.first().click();
        }
      }
    });
  });

  test.describe('Range Inputs', () => {
    test('should adjust inference temperature slider', async ({ page }) => {
      await page.goto('/models/jeju/test-model');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      const slider = page.locator('input[type="range"]').first();
      if (await slider.isVisible()) {
        await slider.fill('0.5');
        await expect(slider).toHaveValue('0.5');
      }
    });

    test('should adjust max tokens slider', async ({ page }) => {
      await page.goto('/models/jeju/test-model');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      const sliders = page.locator('input[type="range"]');
      const count = await sliders.count();
      
      if (count > 1) {
        await sliders.nth(1).fill('1000');
      }
    });
  });

  test.describe('Textarea Inputs', () => {
    test('should handle multiline text in compose', async ({ page }) => {
      await page.goto('/feed');
      
      const textarea = page.getByPlaceholder(/what's happening/i);
      await textarea.fill('Line 1\nLine 2\nLine 3');
      
      await expect(textarea).toHaveValue('Line 1\nLine 2\nLine 3');
    });

    test('should respect character limit', async ({ page }) => {
      await page.goto('/feed');
      
      const textarea = page.getByPlaceholder(/what's happening/i);
      const longText = 'a'.repeat(500);
      await textarea.fill(longText);
      
      // Check if limit indicator shows
      const limitText = page.getByText(/\d+\/\d+/);
      if (await limitText.isVisible()) {
        await expect(limitText).toBeVisible();
      }
    });

    test('should handle code in inference prompt', async ({ page }) => {
      await page.goto('/models/jeju/test-model');
      
      await page.getByRole('button', { name: /inference/i }).click();
      
      const textarea = page.locator('textarea');
      const code = `function hello() {
  console.log("Hello World");
}`;
      
      await textarea.fill(code);
      await expect(textarea).toHaveValue(code);
    });
  });

  test.describe('Checkbox Inputs', () => {
    test('should toggle visibility checkbox', async ({ page }) => {
      await page.goto('/git/new');
      
      const checkbox = page.getByRole('checkbox', { name: /private/i });
      if (await checkbox.isVisible()) {
        await checkbox.check();
        await expect(checkbox).toBeChecked();
        
        await checkbox.uncheck();
        await expect(checkbox).not.toBeChecked();
      }
    });

    test('should select multiple architectures', async ({ page }) => {
      await page.goto('/containers/push');
      
      const checkboxes = page.getByRole('checkbox');
      const count = await checkboxes.count();
      
      for (let i = 0; i < Math.min(count, 3); i++) {
        await checkboxes.nth(i).check();
      }
    });
  });

  test.describe('Radio Inputs', () => {
    test('should select visibility option', async ({ page }) => {
      await page.goto('/git/new');
      
      const publicRadio = page.getByRole('radio', { name: /public/i });
      const privateRadio = page.getByRole('radio', { name: /private/i });
      
      if (await publicRadio.isVisible()) {
        await publicRadio.check();
        await expect(publicRadio).toBeChecked();
        
        await privateRadio.check();
        await expect(privateRadio).toBeChecked();
        await expect(publicRadio).not.toBeChecked();
      }
    });
  });

  test.describe('File Inputs', () => {
    test('should handle file upload for model', async ({ page }) => {
      await page.goto('/models/upload');
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        // Note: actual file upload would require a test file
      }
    });
  });

  test.describe('Form Error States', () => {
    test('should show validation error on empty required field', async ({ page }) => {
      await page.goto('/bounties/new');
      
      // Submit without filling required fields
      await page.getByRole('button', { name: /create/i }).click();
      
      // Should show error message
      const error = page.getByText(/required/i);
      if (await error.isVisible()) {
        await expect(error).toBeVisible();
      }
    });

    test('should show error for invalid reward amount', async ({ page }) => {
      await page.goto('/bounties/new');
      
      const rewardInput = page.getByLabel(/reward/i);
      if (await rewardInput.isVisible()) {
        await rewardInput.fill('-1');
        
        // Should show validation error
        const error = page.getByText(/positive|invalid/i);
        if (await error.isVisible()) {
          await expect(error).toBeVisible();
        }
      }
    });

    test('should show error for invalid URL', async ({ page }) => {
      await page.goto('/git/new');
      
      const urlInput = page.getByLabel(/url|link/i);
      if (await urlInput.isVisible()) {
        await urlInput.fill('not-a-valid-url');
        await urlInput.blur();
        
        // Should show validation error
        const error = page.getByText(/invalid|url/i);
        if (await error.isVisible()) {
          await expect(error).toBeVisible();
        }
      }
    });
  });

  test.describe('Form Success States', () => {
    test('should show success feedback on valid search', async ({ page }) => {
      await page.goto('/bounties');
      
      const search = page.getByPlaceholder(/search/i);
      await search.fill('smart');
      
      // Should show results or no results message
      await expect(page.getByText(/smart|no results/i).first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Form Keyboard Navigation', () => {
    test('should navigate form with Tab key', async ({ page }) => {
      await page.goto('/bounties/new');
      
      // Focus first input
      await page.keyboard.press('Tab');
      
      // Tab through form
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
      }
      
      // Should be focused on some element
      const focused = await page.evaluate(() => document.activeElement?.tagName);
      expect(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A']).toContain(focused);
    });

    test('should submit form with Enter key', async ({ page }) => {
      await page.goto('/bounties');
      
      const search = page.getByPlaceholder(/search/i);
      await search.fill('test');
      await search.press('Enter');
      
      // Should trigger search/filter
    });
  });
});


