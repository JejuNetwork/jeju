import { expect, test } from '@playwright/test'

test.describe('Factory App', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/')

    // Check for main heading in the main content area
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toBeVisible()

    // Check for navigation
    await expect(page.getByRole('navigation')).toBeVisible()
  })

  test('should navigate to bounties page', async ({ page }) => {
    await page.goto('/bounties')

    // Check for bounties page content
    await expect(
      page.getByRole('main').getByRole('heading', { name: /bounties/i }),
    ).toBeVisible()
  })

  test('should navigate to git page', async ({ page }) => {
    await page.goto('/git')

    // Check for repositories heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /repositories/i }),
    ).toBeVisible()
  })

  test('should navigate to packages page', async ({ page }) => {
    await page.goto('/packages')

    // Check for packages heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /packages/i }),
    ).toBeVisible()
  })

  test('should navigate to containers page', async ({ page }) => {
    await page.goto('/containers')

    // Check for container registry heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /container/i }),
    ).toBeVisible()
  })

  test('should navigate to models page', async ({ page }) => {
    await page.goto('/models')

    // Check for model hub heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /model/i }),
    ).toBeVisible()
  })

  test('should navigate to jobs page', async ({ page }) => {
    await page.goto('/jobs')

    // Check for jobs heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /jobs/i }),
    ).toBeVisible()
  })

  test('should navigate to projects page', async ({ page }) => {
    await page.goto('/projects')

    // Check for projects heading - should show the project name
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toBeVisible()
  })

  test('should navigate to feed page', async ({ page }) => {
    await page.goto('/feed')

    // Check for feed heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /feed/i }),
    ).toBeVisible()
  })

  test('should show model upload page', async ({ page }) => {
    await page.goto('/models/upload')

    // Check for upload heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /upload/i }),
    ).toBeVisible()
  })

  test('should have working navigation links', async ({ page }) => {
    await page.goto('/')

    // Click on bounties link in nav
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /bounties/i })
      .click()
    await expect(page).toHaveURL('/bounties')

    // Click on repositories/git link
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /repositories|git/i })
      .click()
    await expect(page).toHaveURL('/git')

    // Click on packages link
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /packages/i })
      .click()
    await expect(page).toHaveURL('/packages')
  })

  test('should navigate to agents page', async ({ page }) => {
    await page.goto('/agents')

    // Check for agents marketplace heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /agent/i }),
    ).toBeVisible()
  })

  test('should navigate to CI/CD page', async ({ page }) => {
    await page.goto('/ci')

    // Check for CI/CD heading
    await expect(
      page.getByRole('main').getByRole('heading', { name: /ci/i }),
    ).toBeVisible()
  })

  test('should navigate to repository detail page', async ({ page }) => {
    await page.goto('/git/jeju/factory')

    // Check for repository name in the main heading (not nav)
    await expect(page.locator('h1').filter({ hasText: 'jeju' })).toBeVisible()

    // Check for code tab button
    await expect(
      page.getByRole('button', { name: /code/i }).first(),
    ).toBeVisible()
  })

  test('should navigate to user profile page', async ({ page }) => {
    await page.goto('/profile/0x1234567890abcdef')

    // Check for profile content
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('should have responsive mobile navigation', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Mobile nav header should be visible (the header with lg:hidden class)
    await expect(page.locator('header.lg\\:hidden')).toBeVisible()
  })

  test('should navigate to package detail page', async ({ page }) => {
    // Using URL-encoded scope for @jeju
    await page.goto('/packages/%40jeju/sdk')

    // Check for package name in the heading (be specific to avoid nav heading)
    await expect(
      page.locator('h1').filter({ hasText: '@jeju/sdk' }),
    ).toBeVisible()
  })

  test('should navigate to model detail page', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')

    // Check for model heading (be specific)
    await expect(
      page.getByRole('heading', { name: /llama-3-jeju-ft/i }).first(),
    ).toBeVisible()

    // Check for tabs
    await expect(
      page.getByRole('button', { name: /model card/i }),
    ).toBeVisible()
  })

  test('should show inference tab on model page', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')

    // Click inference tab
    await page.getByRole('button', { name: /inference/i }).click()

    // Check for input textarea
    await expect(page.locator('textarea')).toBeVisible()

    // Check for generate button
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible()
  })
})
