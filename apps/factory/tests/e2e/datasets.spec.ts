/**
 * Datasets E2E Tests
 * Tests dataset browser and upload functionality
 */

import { expect, test } from '@playwright/test'

test.describe('Dataset Browser', () => {
  test('displays datasets page', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(page.getByRole('heading', { name: /datasets/i })).toBeVisible()
  })

  test('shows upload button', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(
      page.getByRole('link', { name: /upload dataset/i }),
    ).toBeVisible()
  })

  test('shows dataset stats', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(page.getByText(/total datasets/i)).toBeVisible()
    await expect(page.getByText(/total downloads/i)).toBeVisible()
  })

  test('has search functionality', async ({ page }) => {
    await page.goto('/models/datasets')
    const searchInput = page.getByPlaceholder(/search datasets/i)
    await expect(searchInput).toBeVisible()

    await searchInput.fill('contracts')
    await expect(searchInput).toHaveValue('contracts')
  })

  test('has type filter', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(page.getByRole('combobox').first()).toBeVisible()
  })

  test('displays dataset cards', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('shows preview button', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(
      page.getByRole('button', { name: /preview/i }).first(),
    ).toBeVisible()
  })

  test('shows download button', async ({ page }) => {
    await page.goto('/models/datasets')
    await expect(
      page.getByRole('link', { name: /download/i }).first(),
    ).toBeVisible()
  })
})

test.describe('Dataset Upload', () => {
  test('displays upload page', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByText(/upload dataset/i).first()).toBeVisible()
  })

  test('shows CLI and web upload options', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await expect(page.getByRole('button', { name: /cli/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /web upload/i }),
    ).toBeVisible()
  })

  test('shows CLI instructions by default', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await expect(page.getByText(/pip install jeju-hub/i)).toBeVisible()
  })

  test('switches to web upload form', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await page.getByRole('button', { name: /web upload/i }).click()

    await expect(page.getByPlaceholder(/your-org/i)).toBeVisible()
    await expect(page.getByPlaceholder(/my-dataset/i)).toBeVisible()
  })

  test('shows dataset type options', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await page.getByRole('button', { name: /web upload/i }).click()
    await expect(page.getByText(/type/i).first()).toBeVisible()
  })

  test('shows file upload area', async ({ page }) => {
    await page.goto('/models/datasets/upload')
    await page.getByRole('button', { name: /web upload/i }).click()
    await expect(page.getByText(/click to upload/i)).toBeVisible()
  })
})
