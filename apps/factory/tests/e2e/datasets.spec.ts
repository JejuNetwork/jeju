/**
 * Datasets E2E Tests
 * Tests dataset browser and upload functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Datasets', () => {
  test.describe('Dataset Browser', () => {
    test('should display datasets page', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByRole('heading', { name: /datasets/i })).toBeVisible();
    });

    test('should show upload button', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByRole('link', { name: /upload dataset/i })).toBeVisible();
    });

    test('should show dataset stats', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByText(/total datasets/i)).toBeVisible();
      await expect(page.getByText(/total downloads/i)).toBeVisible();
    });

    test('should have search functionality', async ({ page }) => {
      await page.goto('/models/datasets');
      
      const searchInput = page.getByPlaceholder(/search datasets/i);
      await expect(searchInput).toBeVisible();
      
      await searchInput.fill('contracts');
      await expect(searchInput).toHaveValue('contracts');
    });

    test('should have type filter', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByRole('combobox').first()).toBeVisible();
    });

    test('should display dataset cards', async ({ page }) => {
      await page.goto('/models/datasets');
      
      // Check for dataset info
      await expect(page.locator('.card').first()).toBeVisible();
    });

    test('should show preview button', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByRole('button', { name: /preview/i }).first()).toBeVisible();
    });

    test('should show download button', async ({ page }) => {
      await page.goto('/models/datasets');
      
      await expect(page.getByRole('link', { name: /download/i }).first()).toBeVisible();
    });
  });

  test.describe('Dataset Upload', () => {
    test('should display upload page', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByText(/upload dataset/i).first()).toBeVisible();
    });

    test('should show CLI and web upload options', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await expect(page.getByRole('button', { name: /cli/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /web upload/i })).toBeVisible();
    });

    test('should show CLI instructions by default', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await expect(page.getByText(/pip install jeju-hub/i)).toBeVisible();
    });

    test('should switch to web upload form', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await page.getByRole('button', { name: /web upload/i }).click();
      
      await expect(page.getByPlaceholder(/your-org/i)).toBeVisible();
      await expect(page.getByPlaceholder(/my-dataset/i)).toBeVisible();
    });

    test('should show dataset type options', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await page.getByRole('button', { name: /web upload/i }).click();
      
      // Should show type selection grid
      await expect(page.getByText(/type/i).first()).toBeVisible();
    });

    test('should show file upload area', async ({ page }) => {
      await page.goto('/models/datasets/upload');
      
      await page.getByRole('button', { name: /web upload/i }).click();
      
      await expect(page.getByText(/click to upload/i)).toBeVisible();
    });
  });
});

