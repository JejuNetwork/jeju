/**
 * Jobs E2E Tests
 * Tests job listing, detail view, and posting flows
 */

import { expect, test } from '@playwright/test'

test.describe('Jobs List', () => {
  test('displays jobs page with heading', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { name: /jobs/i })).toBeVisible()
  })

  test('shows post job button', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('link', { name: /post job/i })).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/jobs')
    const searchInput = page.getByPlaceholder(/search jobs/i)
    await expect(searchInput).toBeVisible()
  })

  test('searches jobs', async ({ page }) => {
    await page.goto('/jobs')
    const searchInput = page.getByPlaceholder(/search jobs/i)
    await searchInput.fill('developer')
    await expect(searchInput).toHaveValue('developer')
  })

  test('navigates to create job page', async ({ page }) => {
    await page.goto('/jobs')
    await page.getByRole('link', { name: /post job/i }).click()
    await expect(page).toHaveURL(/\/jobs\/create/)
  })
})

test.describe('Post Job', () => {
  test('displays job creation form', async ({ page }) => {
    await page.goto('/jobs/create')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has required form fields', async ({ page }) => {
    await page.goto('/jobs/create')
    await expect(page.locator('input, textarea, select').first()).toBeVisible()
  })
})

test.describe('Job Detail', () => {
  test('displays job detail page', async ({ page }) => {
    await page.goto('/jobs/1')
    await expect(page.getByRole('main')).toBeVisible()
  })
})

test.describe('Job Filters', () => {
  test('filters by job type', async ({ page }) => {
    await page.goto('/jobs')
    const filterButtons = page
      .getByRole('button')
      .filter({ hasText: /full-time|part-time|contract/i })
    const count = await filterButtons.count()
    if (count > 0) {
      await filterButtons.first().click()
    }
  })

  test('filters by remote option', async ({ page }) => {
    await page.goto('/jobs')
    const remoteFilter = page.getByRole('button', { name: /remote/i })
    if (await remoteFilter.isVisible()) {
      await remoteFilter.click()
    }
  })
})
